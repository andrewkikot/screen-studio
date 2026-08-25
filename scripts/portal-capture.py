#!/usr/bin/env python3
"""
Capture a single screenshot via the xdg-desktop-portal ScreenCast API.

Uses persistent restore_token so the portal dialog only appears once.

Usage:
    python3 portal-capture.py <output.png> [restore_token]

On success writes the captured PNG to <output.png> and prints
    TOKEN:<new_restore_token>
on stdout (last line).
"""

import os
import sys
import re
import signal
import tempfile

import gi
gi.require_version('Gst', '1.0')
from gi.repository import GLib, Gst
import dbus
import dbus.mainloop.glib
from dbus.exceptions import DBusException

# ── globals ──────────────────────────────────────────────────────────────

loop = GLib.MainLoop()
bus = None
pipeline = None
restore_token_new = ''
capture_done = False
output_path = ''

SCREENCAST_IFACE = 'org.freedesktop.portal.ScreenCast'
REQUEST_IFACE = 'org.freedesktop.portal.Request'
DEST = 'org.freedesktop.portal.Desktop'
PATH = '/org/freedesktop/portal/desktop'

request_counter = 0
session_counter = 0


# ── helpers ──────────────────────────────────────────────────────────────

def new_token(counter_name):
    global request_counter, session_counter
    if counter_name == 'request':
        request_counter += 1
        return f'r{request_counter}'
    session_counter += 1
    return f's{session_counter}'


def make_request_path(token):
    sender = bus.get_unique_name()[1:]  # strip leading ':'
    sender = sender.replace('.', '_').replace(':', '_')
    return f'/org/freedesktop/portal/desktop/request/{sender}/{token}'


def terminate(code=0):
    global pipeline
    if pipeline is not None:
        pipeline.set_state(Gst.State.NULL)
    loop.quit()
    sys.exit(code)


def on_term(*_):
    terminate(1)


signal.signal(signal.SIGTERM, on_term)
signal.signal(signal.SIGINT, on_term)


# ── D-Bus call wrapper with signal collection ───────────────────────────

class PortalCall:
    """
    Calls a portal method and collects the async Request::Response signal.

    The portal uses the Request interface: each method call returns a
    Request object path, and the actual result arrives as a Response
    signal on that object.
    """

    def __init__(self):
        self.request_path = None
        self.response_code = None
        self.results = {}
        self.done = False
        self.sig_id = None
        self.match_id = None

    def call(self, iface_method, *args, timeout=15000):
        token = new_token('request')
        self.request_path = make_request_path(token)

        # Subscribe to Response signal before making the call
        self.sig_id = bus.add_signal_receiver(
            self._on_response,
            signal_name='Response',
            interface_name=REQUEST_IFACE,
            path=self.request_path,
        )

        portal_obj = bus.get_object(DEST, PATH)
        iface = dbus.Interface(portal_obj, SCREENCAST_IFACE)
        # The method returns the actual Request object path
        handle = getattr(iface, iface_method)
        handle(*args, dbus_interface=SCREENCAST_IFACE)

        # Wait for response
        deadline = GLib.timeout_add(timeout, self._timeout)
        while not self.done:
            loop.iteration()
        GLib.source_remove(deadline)

        # Cleanup signal receiver
        if self.sig_id:
            bus.remove_signal_receiver(self.sig_id)
            self.sig_id = None

        return self.response_code, self.results

    def _on_response(self, response, results):
        self.response_code = int(response)
        self.results = dict(results)
        self.done = True

    def _timeout(self):
        self.done = True
        self.response_code = -1
        return False  # don't repeat


# ── ScreenCast flow ─────────────────────────────────────────────────────

def do_capture(output, restore_token=''):
    global restore_token_new, pipeline

    portal_obj = bus.get_object(DEST, PATH)

    # 1. CreateSession
    session_token = new_token('session')
    call = PortalCall()
    resp, res = call.call('CreateSession', {
        'session_handle_token': session_token,
    })
    if resp != 0:
        print(f'CreateSession failed: {resp}', file=sys.stderr)
        terminate(1)
    session_handle = res.get('session_handle')
    if not session_handle:
        print('No session_handle in CreateSession response', file=sys.stderr)
        terminate(1)

    # 2. SelectSources  (type 4 = MONITOR, persist_mode 2 = permanent)
    select_opts = {
        'multiple': False,
        'types': dbus.UInt32(4),
        'persist_mode': dbus.UInt32(2),
    }
    if restore_token:
        select_opts['restore_token'] = restore_token

    call = PortalCall()
    resp, _res = call.call('SelectSources', session_handle, select_opts)
    if resp != 0:
        print(f'SelectSources failed: {resp}', file=sys.stderr)
        terminate(1)

    # 3. Start  (parent_window='' means no parent)
    call = PortalCall()
    resp, res = call.call('Start', session_handle, '', {})
    if resp != 0:
        print(f'Start failed (user cancelled?): {resp}', file=sys.stderr)
        terminate(1)

    # Grab the new restore_token
    rt = res.get('restore_token', '')
    if rt:
        restore_token_new = str(rt)

    # Grab streams
    streams = res.get('streams', [])
    if not streams:
        print('No streams returned from Start', file=sys.stderr)
        terminate(1)

    # 4. OpenPipeWireRemote → fd
    pw_iface = dbus.Interface(portal_obj, SCREENCAST_IFACE)
    fd = pw_iface.OpenPipeWireRemote(session_handle, {})

    # Each stream is a tuple: (uint32 node_id, dict stream_properties)
    node_id = int(streams[0][0])

    # 5. Use GStreamer pipewiresrc to capture one frame
    pipe_str = (
        f'pipewiresrc fd={fd} path={node_id} '
        f'! videoconvert ! video/x-raw,format=RGBA '
        f'! videoconvert ! pngenc snapshot=true '
        f'! filesink location="{output}"'
    )

    pipeline = Gst.parse_launch(pipe_str)
    bus_gst = pipeline.get_bus()
    bus_gst.add_signal_watch()

    def on_message(_, message):
        t = message.type
        if t == Gst.MessageType.EOS:
            pipeline.set_state(Gst.State.NULL)
            loop.quit()
        elif t == Gst.MessageType.ERROR:
            err, debug = message.parse_error()
            print(f'GStreamer error: {err.message}', file=sys.stderr)
            pipeline.set_state(Gst.State.NULL)
            loop.quit()

    bus_gst.connect('message', on_message)
    pipeline.set_state(Gst.State.PLAYING)

    # Wait for EOS
    loop.run()


def main():
    global bus

    if len(sys.argv) < 2:
        print('Usage: portal-capture.py <output.png> [restore_token]', file=sys.stderr)
        sys.exit(1)

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    Gst.init(None)

    bus = dbus.SessionBus()
    output = sys.argv[1]
    token = sys.argv[2] if len(sys.argv) > 2 else ''

    try:
        do_capture(output, token)
    except DBusException as e:
        print(f'D-Bus error: {e}', file=sys.stderr)
        terminate(1)

    if restore_token_new:
        print(f'TOKEN:{restore_token_new}')


if __name__ == '__main__':
    main()

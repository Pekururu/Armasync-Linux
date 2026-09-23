#!/usr/bin/env python3
"""Generate synthetic Java Object Serialization fixtures; no real credentials.

Uses the stream grammar defined by the Java Serialization Specification.
Only the field layouts consumed by Armasync are represented. No JDK required.
"""
import gzip
import hashlib
import struct
from pathlib import Path


def utf(value):
    data = value.encode('utf-8')  # All fixture strings are ASCII.
    return struct.pack('>H', len(data)) + data


def string(value):
    return b'\x74' + utf(value)


def descriptor(name, fields, flags=2):
    return (b'\x72' + utf(name) + struct.pack('>qBH', 1, flags, len(fields))
            + b''.join(kind.encode() + utf(key) + (string('Ljava/lang/Object;') if kind == 'L' else b'')
                       for kind, key, _ in fields) + b'\x78\x70')


def obj(name, fields, annotation=None):
    data = b''
    for kind, _, value in fields:
        data += {'Z': lambda: bytes([value]), 'I': lambda: struct.pack('>i', value),
                 'J': lambda: struct.pack('>q', value), 'L': lambda: value}[kind]()
    return b'\x73' + descriptor(name, fields, 3 if annotation is not None else 2) + data + (annotation + b'\x78' if annotation is not None else b'')


def block(value):
    return b'\x77' + bytes([len(value)]) + value


def array(values):
    return obj('java.util.ArrayList', [('I', 'size', len(values))], block(struct.pack('>i', len(values))) + b''.join(values))


def mapping(keys):
    return obj('java.util.HashMap', [], block(struct.pack('>ii', 16, len(keys))) + b''.join(string(key) + b'\x70' for key in keys))


PREFIX = 'fr.soe.a3s.domain.repository.'


def directory(name, children, addon=False):
    return obj(PREFIX + 'SyncTreeDirectory', [('Z', 'markAsAddon', addon), ('L', 'name', string(name)), ('L', 'list', array(children))])


def leaf(name, contents):
    return obj(PREFIX + 'SyncTreeLeaf', [('Z', 'deleted', False), ('Z', 'compressed', False),
        ('J', 'size', len(contents)), ('J', 'compressedSize', 0), ('L', 'name', string(name)),
        ('L', 'sha1', string(hashlib.sha1(contents).hexdigest() if contents else '0'))])


def event(name, addons):
    return obj(PREFIX + 'Event', [('L', 'name', string(name)), ('L', 'description', string('Synthetic test event')),
        ('L', 'addonNames', mapping(addons)), ('L', 'userconfigFolderNames', mapping(['test-config']))])


protocol_type = b'\x7e' + descriptor('test.ProtocolType', [], 0x12) + string('FTP')
protocol = obj('test.Protocol', [('L', 'url', string('repo.example.test')), ('L', 'port', string('21')),
    ('L', 'login', string('fixture-user')), ('L', 'password', string('not-a-real-password')), ('L', 'protocolType', protocol_type)])
autoconfig = obj(PREFIX + 'AutoConfig', [('L', 'repositoryName', string('Synthetic repository')), ('L', 'protocole', protocol)])
manifest = directory('root', [
    directory('collection', [directory('@Alpha', [directory('addons', [leaf('example.pbo', b'fixture data')]), leaf('empty.txt', b'')], True)]),
    directory('@Bravo', [leaf('file.pbo', b'bravo')], True),
    directory('one', [directory('@Duplicate', [leaf('one.pbo', b'one')], True)]),
    directory('two', [directory('@Duplicate', [leaf('two.pbo', b'two')], True)]),
])
events = obj(PREFIX + 'Events', [('L', 'list', array([event('Unit', ['@Bravo', '@Alpha']), event('Extended', ['@Alpha', '@Bravo', '@External'])]))])
folder = Path(__file__).resolve().parents[1] / 'src-tauri/tests/fixtures'
for name, value in [('autoconfig', autoconfig), ('sync', manifest), ('events', events), ('unsafe-sync', directory('root', [directory('@Alpha', [leaf('../escape', b'bad')], True)]))]:
    compressed = bytearray(gzip.compress(b'\xac\xed\x00\x05' + value, mtime=0))
    compressed[9] = 255  # Normalize the OS byte across Python/zlib versions.
    (folder / (name + '.gz')).write_bytes(compressed)

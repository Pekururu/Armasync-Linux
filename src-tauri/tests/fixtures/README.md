# Synthetic Arma3Sync protocol fixtures

These small gzip streams contain Java Object Serialization records with the
class names and field layouts read by Armasync. They contain invented addon
names, an example.test hostname, and nonfunctional credentials. They replace
unavailable private repository dumps; they are not snapshots of a live server.

Regenerate with `python3 scripts/generate-fixtures.py` from the project root.
The generator records the serialization grammar directly, so a JDK is not
needed. Tests cover AutoConfig, Events/HashMap membership, nested addon paths,
duplicate addon names, empty-file sentinels, and path traversal rejection.

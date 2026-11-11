import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(__file__).resolve().parents[1] / 'src/usr/local/emhttp/plugins/iscsi.manager/include/iscsi_ctl.py'
spec = importlib.util.spec_from_file_location('iscsi_ctl', HELPER)
ctl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ctl)


class Storage:
    plugin = 'fileio'

    def __init__(self, directory, name, mode, wce=0):
        self.name = name
        self.path = str(Path(directory) / name)
        Path(self.path).mkdir()
        Path(self.path, 'info').write_text('Mode: %s Async: 0\n' % mode)
        self.attrs = {'emulate_write_cache': wce, 'emulate_fua_write': 1}
        self.fail_wce = False

    def get_attribute(self, key):
        return str(self.attrs[key])

    def set_attribute(self, key, value):
        if self.fail_wce and key == 'emulate_write_cache' and int(value) == 1:
            self.fail_wce = False
            raise OSError('kernel rejected WCE')
        self.attrs[key] = int(value)


class Root:
    def __init__(self, stores):
        self.storage_objects = stores

    def dump(self):
        return {'storage_objects': [dict(name=s.name, plugin=s.plugin,
                                        write_back=bool(s.attrs['emulate_write_cache']),
                                        attributes=s.attrs.copy())
                                    for s in self.storage_objects]}


class FUACompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)

    def store(self, name='sync', mode='O_DSYNC', wce=0):
        return Storage(self.temp.name, name, mode, wce)

    def test_enable_preserves_sync_mode(self):
        so = self.store()
        ctl.set_fua_compat(so, True)
        self.assertEqual(so.attrs, {'emulate_write_cache': 1, 'emulate_fua_write': 1})
        self.assertEqual(ctl.fileio_mode(so), 'O_DSYNC')
        ctl.set_fua_compat(so, False)
        self.assertEqual(so.attrs['emulate_write_cache'], 0)

    def test_buffered_and_unknown_modes_rejected(self):
        for mode in ('Buffered-WCE', 'unknown'):
            so = self.store(name=mode, mode=mode, wce=1)
            with self.assertRaises(ctl.UserError):
                ctl.set_fua_compat(so, True)
            self.assertEqual(so.attrs['emulate_write_cache'], 1)

    def test_kernel_failure_rolls_back(self):
        so = self.store()
        so.attrs['emulate_fua_write'] = 0
        so.fail_wce = True
        with self.assertRaises(OSError):
            ctl.set_fua_compat(so, True)
        self.assertEqual(so.attrs, {'emulate_write_cache': 0, 'emulate_fua_write': 0})

    def test_save_keeps_sync_and_buffered_modes_separate(self):
        sync = self.store(wce=1)
        buffered = self.store('buffered', 'Buffered-WCE', 1)
        stores = ctl.config_dump(Root([sync, buffered]))['storage_objects']
        self.assertFalse(stores[0]['write_back'])
        self.assertEqual(stores[0]['attributes']['emulate_write_cache'], 1)
        self.assertTrue(stores[1]['write_back'])

    def test_atomic_save_preserves_symlink_and_private_permissions(self):
        actual = Path(self.temp.name, 'flash.json')
        actual.write_text('{}')
        link = Path(self.temp.name, 'saveconfig.json')
        link.symlink_to(actual)
        with patch.object(ctl, 'SAVE_FILE', str(link)):
            ctl.save(Root([self.store(wce=1)]))
        self.assertTrue(link.is_symlink())
        self.assertEqual(actual.stat().st_mode & 0o777, 0o600)
        self.assertFalse(json.loads(actual.read_text())['storage_objects'][0]['write_back'])

    def test_active_session_blocks_change(self):
        so = self.store()
        tpg = type('TPG', (), {'node_acls': []})()
        so.attached_luns = [type('LUN', (), {'parent_tpg': tpg})()]
        with patch.object(ctl, 'find_so', return_value=so), patch.object(ctl, 'dynamic_sessions', return_value=['client']):
            with self.assertRaises(ctl.UserError):
                ctl.act_set_fua_compat(None, None, {'name': 'sync'})
        self.assertEqual(so.attrs['emulate_write_cache'], 0)

    def test_dynamic_sessions_nul_terminated_unicode_and_duplicates(self):
        tpg = type('TPG', (), {'path': self.temp.name})()
        iqn = 'iqn.2026-08.me.herko:test的mac-mini'
        Path(tpg.path, 'dynamic_sessions').write_bytes((iqn + '\n\x00').encode())
        self.assertEqual(ctl.dynamic_sessions(tpg), [iqn])
        Path(tpg.path, 'dynamic_sessions').write_text(iqn + '\n' + iqn + '\n\x00iqn.2026-08.example:second\n\x00')
        self.assertEqual(ctl.dynamic_sessions(tpg), [iqn, 'iqn.2026-08.example:second'])
        Path(tpg.path, 'dynamic_sessions').write_bytes(b'\x00\n ')
        self.assertEqual(ctl.dynamic_sessions(tpg), [])


if __name__ == '__main__':
    unittest.main()

"""Exercise the patched vendor getter from the actual bundled runtime."""
import ast
import importlib.util
from pathlib import Path
import re
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('patch_rtslib', ROOT / 'scripts/patch_rtslib.py')
patcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patcher)


class RuntimePatchTests(unittest.TestCase):
    def test_bundled_getter_uses_mode_not_wce(self):
        with tempfile.TemporaryDirectory() as temp:
            egg = Path(temp, 'rtslib.egg')
            with tarfile.open(next((ROOT / 'packages/runtime').glob('iSCSI-*.txz'))) as package:
                member = next(m for m in package.getmembers() if 'rtslib_fb-' in m.name and m.name.endswith('.egg'))
                egg.write_bytes(package.extractfile(member).read())
            patcher.patch_egg(egg)
            with zipfile.ZipFile(egg) as archive:
                source = archive.read('rtslib_fb/tcm.py').decode()
                self.assertNotIn('rtslib_fb/tcm.pyc', archive.namelist())
            tree = ast.parse(source)
            cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'FileIOStorageObject')
            getter = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == '_get_wb_enabled')
            info = ['Mode: O_DSYNC Async: 0']
            ns = {'re': re, 'fread': lambda path: info[0], 'RTSLibError': RuntimeError}
            exec(compile(ast.Module(body=[getter], type_ignores=[]), '<vendor getter>', 'exec'), ns)
            storage = type('Storage', (), {'path': '/fake', '_check_self': lambda self: None})()
            for mode, expected in [('O_DSYNC', False), ('Buffered-WCE', True)]:
                info[0] = 'Mode: %s Async: 0' % mode
                self.assertIs(ns['_get_wb_enabled'](storage), expected)
            info[0] = 'Mode: unknown'
            with self.assertRaises(RuntimeError):
                ns['_get_wb_enabled'](storage)


if __name__ == '__main__':
    unittest.main()

"""Patch bundled rtslib 2.1.75 so all callers save the actual fileio mode."""
from pathlib import Path
import os
import sys
import zipfile

OLD = '''    def _get_wb_enabled(self):
        self._check_self()
        return bool(int(self.get_attribute("emulate_write_cache")))
'''
NEW = '''    def _get_wb_enabled(self):
        self._check_self()
        # Advertised WCE may be enabled solely for FUA compatibility.
        # Restore must reopen the file using its actual I/O mode.
        info = fread("%s/info" % self.path)
        mode = re.search(r"\\bMode:\\s*(\\S+)", info)
        if mode and mode.group(1) == "O_DSYNC":
            return False
        if mode and mode.group(1) == "Buffered-WCE":
            return True
        raise RTSLibError("Cannot determine fileio I/O mode; refusing to save an ambiguous write_back value")
'''


def patch_egg(path):
    path = Path(path)
    temporary = path.with_name(path.name + '.new')
    try:
        with zipfile.ZipFile(path) as source, zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as dest:
            patched = False
            for item in source.infolist():
                if item.filename == 'rtslib_fb/tcm.pyc' or (item.filename.startswith('rtslib_fb/__pycache__/tcm.') and item.filename.endswith('.pyc')):
                    continue
                data = source.read(item.filename)
                if item.filename == 'rtslib_fb/tcm.py':
                    start = data.index(b'class FileIOStorageObject(')
                    end = data.index(b'\nclass ', start + 1)
                    section = data[start:end]
                    assert section.count(OLD.encode()) == 1, 'rtslib FileIO implementation changed'
                    data = data[:start] + section.replace(OLD.encode(), NEW.encode()) + data[end:]
                    patched = True
                dest.writestr(item, data)
            assert patched, 'rtslib tcm.py missing'
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


if __name__ == '__main__':
    patch_egg(sys.argv[1])
    print('patched', Path(sys.argv[1]).name)

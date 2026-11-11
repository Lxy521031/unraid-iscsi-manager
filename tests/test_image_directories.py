import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_fua_compat import ctl


class ImageDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'mnt'
        self.pool = self.root / 'pool'
        self.pool.mkdir(parents=True)

    def create(self, path):
        with patch.object(ctl.os.path, 'ismount', side_effect=lambda p: p == str(self.pool)):
            ctl.create_image_parent(str(path), str(self.root))

    def test_nested_directory_on_mounted_storage(self):
        target = self.pool / 'iscsi' / 'images'
        self.create(target)
        self.assertTrue(target.is_dir())
        marker = target / 'keep'
        marker.write_text('existing')
        self.create(target)
        self.assertEqual(marker.read_text(), 'existing')

    def test_unmounted_pool_is_not_created(self):
        target = self.root / 'offline' / 'iscsi'
        with self.assertRaises(ctl.UserError):
            self.create(target)
        self.assertFalse(target.parent.exists())

    def test_symlink_outside_storage_rejected(self):
        outside = Path(self.temp.name) / 'outside'
        outside.mkdir()
        (self.pool / 'link').symlink_to(outside)
        with self.assertRaises(ctl.UserError):
            self.create(self.pool / 'link' / 'images')
        self.assertFalse((outside / 'images').exists())

    def test_file_in_path_rejected(self):
        (self.pool / 'file').write_text('keep')
        with self.assertRaises(ctl.UserError):
            self.create(self.pool / 'file' / 'images')

    def test_missing_directory_requires_opt_in(self):
        root = type('Root', (), {'storage_objects': []})()
        with self.assertRaisesRegex(ctl.UserError, '勾选'):
            ctl.act_create_backstore(None, root, {'type': 'fileio', 'name': 'test',
                'path': str(self.pool / 'missing' / 'test.img'), 'size': '8M'})
        self.assertFalse((self.pool / 'missing').exists())

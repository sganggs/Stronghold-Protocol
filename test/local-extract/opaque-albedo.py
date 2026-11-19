"""CPU-only regression: preserve opaque RGB without destroying a shared cutout atlas."""
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/local-extract'))
import scenes


class OpaqueAlbedo(unittest.TestCase):
    def test_rgb_beneath_zero_alpha_is_preserved_and_native_file_is_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / scenes.TEX_SUB
            folder.mkdir(parents=True)
            native = Image.new('RGBA', (2, 2))
            native.putdata([(146, 147, 148, 0), (16, 30, 45, 1), (2, 4, 6, 128), (255, 240, 210, 255)])
            native.save(folder / 'Atlas.png')
            digest = hashlib.sha256((folder / 'Atlas.png').read_bytes()).digest()
            manifest = {scenes.TEX_SUB: {'Atlas': {'path': '/assets/local/scene/tex/Atlas.png'}}}
            opaque = {'kind': 'lit', 'map': 'Atlas', 'keywords': []}
            cutout = {'kind': 'lit', 'map': 'Atlas', 'keywords': ['_ALPHATEST_ON']}
            self.assertEqual(scenes.export_opaque_albedo(opaque, root, manifest), 1)
            self.assertNotEqual(opaque['map'], 'Atlas')
            entry = manifest[scenes.TEX_SUB][opaque['map']]
            with Image.open(folder / Path(entry['path']).name) as result:
                self.assertEqual(result.convert('RGB').tobytes(), native.convert('RGB').tobytes())
                self.assertEqual(result.convert('RGBA').getchannel('A').getextrema(), (255, 255))
            self.assertEqual(hashlib.sha256((folder / 'Atlas.png').read_bytes()).digest(), digest)
            self.assertEqual(scenes.export_opaque_albedo(cutout, root, manifest), 0)
            self.assertEqual(cutout['map'], 'Atlas')
            another = {'map': 'Atlas', 'keywords': []}
            self.assertEqual(scenes.export_opaque_albedo(another, root, manifest), 0)
            self.assertEqual(another['map'], opaque['map'])
            self.assertEqual(len(manifest[scenes.TEX_SUB]), 2)

    def test_no_change_to_other_opacity_modes_or_images_without_zero_alpha(self):
        image = Image.new('RGBA', (2, 2), (140, 150, 160, 0))
        for keywords in [['_ALPHATEST_ON'], ['_ALPHABLEND_ON'], ['_ALPHAPREMULTIPLY_ON']]:
            self.assertIsNone(scenes.opaque_albedo(image, {'keywords': keywords}))
        self.assertIsNone(scenes.opaque_albedo(image, {'kind': 'water'}))
        self.assertIsNone(scenes.opaque_albedo(image, {'shader': 'Arknights/Trap/Shadow'}))
        self.assertIsNone(scenes.opaque_albedo(image.convert('RGB'), {}))
        self.assertIsNone(scenes.opaque_albedo(Image.new('RGBA', (2, 2), (140, 150, 160, 1)), {}))
        self.assertIsNone(scenes.opaque_albedo(Image.new('RGBA', (2, 2), (140, 150, 160, 255)), {}))


if __name__ == '__main__':
    unittest.main()

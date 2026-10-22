import importlib.util,json,pathlib,tempfile,unittest
from unittest.mock import patch,Mock
spec=importlib.util.spec_from_file_location('delivery',pathlib.Path(__file__).resolve().parents[1]/'scripts/wechat_delivery.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DeliveryTests(unittest.TestCase):
 def test_failure_backs_off_without_marking_success(self):
  with tempfile.TemporaryDirectory() as d,patch.object(m.subprocess,'run',return_value=Mock(returncode=1)) as run:
   for _ in range(2):
    with self.assertRaises(RuntimeError):m.deliver({'account':'a','target':'b'},'test',d,'cli')
   self.assertEqual(run.call_count,1);self.assertNotIn('lastSuccessAt',json.loads((pathlib.Path(d)/'delivery.json').read_text()))
 def test_serverchan_success_uses_private_key_and_no_cli(self):
  with tempfile.TemporaryDirectory() as d,patch.object(m.urllib.request,'urlopen') as request,patch.object(m.subprocess,'run') as run:
   (pathlib.Path(d)/'serverchan.json').write_text(json.dumps({'sendkey':'SCT123test'}))
   request.return_value.__enter__.return_value.read.return_value=b'{"code":0}'
   m.deliver({},'title\nbody',d,'cli');run.assert_not_called()
   self.assertEqual(json.loads((pathlib.Path(d)/'delivery.json').read_text())['failures'],0)
if __name__=='__main__':unittest.main()

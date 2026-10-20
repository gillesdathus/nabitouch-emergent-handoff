"""Refusal tests: a backup must never use a production destination or shared network."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("staging_backup", ROOT / "deploy/staging/backup.py")
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupIsolation(unittest.TestCase):
    def refuses(self, *, database="nabitouch_staging", image="nabitouch-staging-api:97fde6f", project="nabitouch-staging", networks=None, volume="nabitouch-staging_staging-mongo", reason):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            (base / "api.env").write_text(f"DB_NAME={database}\nMONGO_URL=mongodb://mongo:27017/{database}\n")
            (base / "compose.env").write_text("STAGING_API_IMAGE=" + image + "\n")
            row = {"Config": {"Labels": {"com.docker.compose.project": project}},
                   "NetworkSettings": {"Networks": {key: {} for key in (networks or ["nabitouch-staging_data"])}},
                   "Mounts": [{"Name": volume, "Destination": "/data/db"}]}
            def inspect_only(args, **kwargs):
                self.assertEqual(args, ["docker", "inspect", "nabitouch-staging-mongo-1"])
                return json.dumps([row]).encode()
            with patch.object(backup, "BASE", base), patch.object(backup.os, "geteuid", return_value=0, create=True), patch.object(backup, "run", side_effect=inspect_only):
                with self.assertRaisesRegex(RuntimeError, reason):
                    backup.main()
            self.assertFalse((base / "backups").exists(), "Guard must fail before backup or recovery writes")
            self.assertFalse((base / "recovery").exists())

    def test_production_database_refused(self):
        self.refuses(database="nabitouch_prod", reason="non-staging Mongo")

    def test_production_image_or_container_project_refused(self):
        self.refuses(image="nt-next-api:local", reason="non-staging encryption image")
        self.refuses(project="nt-next", reason="non-staging container")

    def test_production_network_attachment_refused(self):
        self.refuses(networks=["nabitouch-staging_data", "nt-next"], reason="network attachment")

    def test_production_volume_refused(self):
        self.refuses(volume="nt-next-mongo", reason="database volume")


if __name__ == "__main__":
    unittest.main()

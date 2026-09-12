import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]
SETUP = tomllib.loads((ROOT / ".conductor/settings.toml").read_text())["scripts"]["setup"]
SHELL = shutil.which("zsh") or "/bin/bash"


class ConductorSetupTest(unittest.TestCase):
    def run_setup(self, *, asdf=True, plugin=False, plugin_failure=False):
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            bin_path = temporary / "bin"
            bin_path.mkdir()
            if plugin:
                (temporary / "plugin").touch()
            commands = {
                "npm": '#!/bin/sh\n[ "$*" = "ci --engine-strict" ] || exit 1\ntouch "$TEST_STATE/dependencies"\n',
            }
            if asdf:
                commands["asdf"] = """#!/bin/sh
set -e
case "$*" in
  'plugin list')
    if [ -f "$TEST_STATE/plugin" ]; then printf 'nodejs\n'; fi
    ;;
  'plugin add nodejs https://github.com/asdf-vm/asdf-nodejs.git')
    [ "$TEST_PLUGIN_FAILURE" != 1 ] || exit 42
    [ ! -f "$TEST_STATE/plugin" ] || exit 43
    touch "$TEST_STATE/plugin"
    ;;
  'install nodejs')
    [ -f "$TEST_STATE/plugin" ] || exit 44
    touch "$TEST_STATE/node"
    ;;
  *) exit 45 ;;
esac
"""
            for name, content in commands.items():
                executable = bin_path / name
                executable.write_text(content)
                executable.chmod(0o755)
            env = {
                **os.environ,
                "PATH": f"{bin_path}:/usr/bin:/bin",
                "TEST_STATE": str(temporary),
                "TEST_PLUGIN_FAILURE": "1" if plugin_failure else "0",
            }
            result = subprocess.run(
                [SHELL, "-f", "-c", SETUP], cwd=ROOT, env=env,
                capture_output=True, text=True, timeout=10,
            )
            return result, {name for name in ("plugin", "node", "dependencies") if (temporary / name).exists()}

    def test_missing_plugin_is_installed_before_node_and_dependencies(self):
        result, installed = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(installed, {"plugin", "node", "dependencies"})

    def test_existing_plugin_is_reused(self):
        result, installed = self.run_setup(plugin=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(installed, {"plugin", "node", "dependencies"})

    def test_without_asdf_installs_dependencies_with_existing_node(self):
        result, installed = self.run_setup(asdf=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(installed, {"dependencies"})

    def test_plugin_install_failure_stops_setup(self):
        result, installed = self.run_setup(plugin_failure=True)
        self.assertEqual(result.returncode, 42)
        self.assertNotIn("node", installed)
        self.assertNotIn("dependencies", installed)


if __name__ == "__main__":
    unittest.main()

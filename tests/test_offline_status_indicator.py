import re
import shutil
import subprocess
import unittest
from pathlib import Path


class TestFrontendOfflineAndStatusIndicator(unittest.TestCase):
    """
    Test suite verifying that frontend offline metric handling and
    connectivity status indicator tests execute and pass via Node.js.
    """

    def test_node_offline_and_status_indicator_tests_pass(self):
        """Execute Node.js test runner for offline metric and status indicator tests."""
        node_bin = shutil.which("node")
        self.assertIsNotNone(node_bin, "Node.js executable is required to run frontend tests")

        repo_root = Path(__file__).resolve().parent.parent
        test_file = repo_root / "tests" / "offline_status_indicator.test.js"
        self.assertTrue(test_file.exists(), f"Test file {test_file} must exist")

        result = subprocess.run(
            [node_bin, "--test", str(test_file)],
            cwd=str(repo_root),
            capture_output=True,
            text=True
        )

        self.assertEqual(
            result.returncode,
            0,
            f"Node test runner failed with exit code {result.returncode}.\nOutput:\n{result.stdout}\nError:\n{result.stderr}"
        )
        self.assertIn("fail 0", result.stdout)

        pass_match = re.search(r"pass\s+(\d+)", result.stdout)
        self.assertIsNotNone(
            pass_match,
            f"Could not find passing test count in output:\n{result.stdout}"
        )
        passed_count = int(pass_match.group(1))
        self.assertGreater(
            passed_count,
            0,
            f"Expected at least one passing test, but found {passed_count}."
        )


if __name__ == "__main__":
    unittest.main()


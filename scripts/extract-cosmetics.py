"""The definitive user artwork is the only active source."""
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).with_name("extract-definitive-cosmetics.py")), run_name="__main__")

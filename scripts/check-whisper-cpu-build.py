#!/usr/bin/env python3
"""Check the actual whisper-rs-sys CMake output used for an arm64 release."""

import argparse
import json
from pathlib import Path
import shlex
import subprocess


def check_build(build_dir):
    cache = (build_dir / "CMakeCache.txt").read_text()
    for setting in (
        "GGML_NATIVE:BOOL=OFF",
        "GGML_CPU_ARM_ARCH:STRING=armv8-a",
        "GGML_METAL:BOOL=ON",
        "GGML_METAL_EMBED_LIBRARY:BOOL=ON",
    ):
        if setting not in cache.splitlines():
            raise RuntimeError(f"missing portable voice build setting: {setting}")

    commands = json.loads((build_dir / "compile_commands.json").read_text())
    cpu_commands = [entry for entry in commands if "/ggml-cpu/" in entry["file"]]
    if not cpu_commands:
        raise RuntimeError("no ggml CPU compilation commands found")
    for entry in cpu_commands:
        args = entry.get("arguments") or shlex.split(entry["command"])
        architecture = [arg for arg in args if arg.startswith(("-march=", "-mcpu="))]
        if architecture != ["-march=armv8-a"]:
            raise RuntimeError(f"non-portable architecture flags in {entry['file']}: {architecture}")

    quants = next(entry for entry in cpu_commands if entry["file"].endswith("/arch/arm/quants.c"))
    args = iter(quants.get("arguments") or shlex.split(quants["command"]))
    preprocess = []
    for arg in args:
        if arg in ("-o", "-MF", "-MT", "-MQ"):
            next(args)
        elif arg not in ("-c", "-MD", "-MMD"):
            preprocess.append(arg)
    macros = subprocess.check_output(
        [*preprocess, "-dM", "-E"], cwd=quants["directory"], text=True
    )
    if "#define __ARM_NEON 1" not in macros:
        raise RuntimeError("portable ARM build lost NEON support")
    for feature in ("MATMUL_INT8", "DOTPROD", "SVE", "SME"):
        if f"#define __ARM_FEATURE_{feature} " in macros:
            raise RuntimeError(f"portable ARM build unexpectedly enables {feature}")
    print(f"Verified {len(cpu_commands)} portable ARM CPU commands; NEON and embedded Metal retained")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("build_dir", type=Path)
    check_build(parser.parse_args().build_dir)

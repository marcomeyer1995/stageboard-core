# libopus (vendored)

- **Version:** 1.5.2, release tarball `opus-1.5.2.tar.gz` from
  https://github.com/xiph/opus/releases/download/v1.5.2/opus-1.5.2.tar.gz
- **SHA-256 of the tarball:** `65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1`
  (as in Xiph's `SHA256SUMS.txt` for 1.5.2)
- **Licence:** BSD 3-clause, see `COPYING` - keep it with the code and name it in the app's licences.
- **Why vendored, not fetched at build time:** builds without internet and nobody can change the
  code unnoticed (Marco, 2026-11-10). Decision on the format and decoder: docs/30 §8h.

## What was taken

Unchanged from the tarball: `celt/`, `silk/`, `src/`, `include/`, `cmake/`, `CMakeLists.txt`, the
`*.mk` source lists, `Makefile.am` and `configure.ac` (CMake reads the source lists and the library
version from them), `package_version`, `COPYING`, `AUTHORS`, `README`.

Left out: `dnn/` except its headers (the sources include them even with the neural extensions
off; the ~18 MB of model weights are not needed), `src/opus_demo.c`, `src/opus_compare.c`,
`src/repacketizer_demo.c`, `tests/`, `doc/`, autotools/meson files.

Built with DRED, OSCE and deep PLC off (libopus' defaults) - see `native/engine/CMakeLists.txt`.

## Updating

Download the new release tarball, check its SHA-256 against Xiph's `SHA256SUMS.txt`, replace the
directories above the same way, run the engine tests (`native/engine`), update this file.

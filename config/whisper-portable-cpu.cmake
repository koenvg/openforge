# whisper-rs-sys 0.14.1 forwards CMAKE_* environment variables, not GGML_*.
# Loaded by project("whisper.cpp") after CMake has identified the target.
# Use a distributable baseline, never the build runner's CPU feature probes.
if(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    if(CMAKE_OSX_ARCHITECTURES STREQUAL "arm64" OR
       (NOT CMAKE_OSX_ARCHITECTURES AND CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64)$"))
        set(GGML_NATIVE OFF CACHE BOOL "Do not specialize voice kernels for the build host" FORCE)
        set(GGML_CPU_ARM_ARCH "armv8-a" CACHE STRING "Portable Apple Silicon CPU baseline" FORCE)
    endif()
endif()

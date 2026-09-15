//! Bind the human build label to the kernel's loaded code identity, not a mutable path.
use openforge_session_protocol::Error;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
unsafe extern "C" {
    fn csops(
        pid: libc::pid_t,
        operations: libc::c_uint,
        address: *mut libc::c_void,
        size: libc::size_t,
    ) -> libc::c_int;
}
pub(super) fn current() -> Result<String, Error> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        // Darwin CS_OPS_CDHASH returns the 20-byte identity of this loaded image.
        // This identifies code; it does not establish publisher trust.
        const CS_OPS_CDHASH: libc::c_uint = 5;
        let mut hash = [0u8; 20];
        // SAFETY: pid zero selects this process and the output spans exactly hash.len().
        if unsafe { csops(0, CS_OPS_CDHASH, hash.as_mut_ptr().cast(), hash.len()) } != 0 {
            return Err(Error::UnsupportedReplacement);
        }
        let identity = hash
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        Ok(format!("{}@{identity}", super::IMAGE_VERSION))
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    Err(Error::UnsupportedReplacement)
}

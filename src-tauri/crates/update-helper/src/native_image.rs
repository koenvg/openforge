//! Bind the kernel's loaded code identity to authenticated on-disk bytes.
//! Code-signature validity here does not establish publisher trust.
#[cfg(target_os = "macos")]
pub(crate) use macos::{verify, verify_integrity};

#[cfg(not(target_os = "macos"))]
pub(crate) fn verify(_pid: u32, _executable: &std::path::Path) -> Result<(), String> {
    Err("running update image verification requires macOS".into())
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn verify_integrity(_bundle: &std::path::Path) -> Result<(), String> {
    Err("update code integrity verification requires macOS".into())
}

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::{
        base::{CFType, CFTypeRef, TCFType},
        data::CFData,
        dictionary::{CFDictionary, CFDictionaryRef},
        string::{CFString, CFStringRef},
        url::CFURL,
    };
    use security_framework::os::macos::code_signing::{Flags, SecRequirement, SecStaticCode};
    use std::path::Path;

    #[link(name = "Security", kind = "framework")]
    unsafe extern "C" {
        // This API accepts both static and dynamic code objects.
        fn SecCodeCopySigningInformation(
            code: CFTypeRef,
            flags: u32,
            info: *mut CFDictionaryRef,
        ) -> i32;
        static kSecCodeInfoUnique: CFStringRef;
        fn csops(
            pid: libc::pid_t,
            operation: libc::c_uint,
            address: *mut libc::c_void,
            size: libc::size_t,
        ) -> libc::c_int;
    }

    pub(crate) fn verify(pid: u32, executable: &Path) -> Result<(), String> {
        let pid = i32::try_from(pid).map_err(|_| "invalid image process")?;
        if pid <= 1 {
            return Err("invalid image process".into());
        }
        let expected = code_hash(executable)?;
        const CS_OPS_CDHASH: libc::c_uint = 5;
        let mut running = [0u8; 20];
        // SAFETY: pid is positive and the output spans exactly running.len().
        if unsafe {
            csops(
                pid,
                CS_OPS_CDHASH,
                running.as_mut_ptr().cast(),
                running.len(),
            )
        } != 0
        {
            return Err("cannot identify the running update image".into());
        }
        if expected.as_slice() != running {
            return Err("running update image does not match the authorized executable".into());
        }
        Ok(())
    }

    pub(crate) fn verify_integrity(bundle: &Path) -> Result<(), String> {
        for name in [
            "Open Forge",
            "openforge-sidecar",
            "openforge-session-daemon",
            "openforge-update-helper",
        ] {
            code_hash(&bundle.join("Contents/MacOS").join(name))
                .map_err(|error| format!("{name}: {error}"))?;
        }
        Ok(())
    }

    fn code_hash(executable: &Path) -> Result<Vec<u8>, String> {
        let path = CFURL::from_path(executable, false).ok_or("invalid image path")?;
        let code = SecStaticCode::from_path(&path, Flags::NONE).map_err(message)?;
        let requirement: SecRequirement = "true".parse().map_err(message)?;
        // Integrity is independent of the separately authenticated publisher/local grant.
        code.check_validity(
            Flags::STRICT_VALIDATE | Flags::NO_NETWORK_ACCESS,
            &requirement,
        )
        .map_err(message)?;
        signing_hash(&code)
    }

    fn signing_hash(code: &SecStaticCode) -> Result<Vec<u8>, String> {
        let mut info = std::ptr::null();
        // SAFETY: code is a live Security.framework object; info is writable.
        // Flag zero requests the basic information, including its unique CDHash.
        let status = unsafe { SecCodeCopySigningInformation(code.as_CFTypeRef(), 0, &mut info) };
        if status != 0 || info.is_null() {
            return Err(format!("cannot read image signing information: {status}"));
        }
        // SAFETY: the successful Copy call returns one retained dictionary.
        let info = unsafe { CFDictionary::<CFString, CFType>::wrap_under_create_rule(info) };
        // SAFETY: Security.framework exports a permanent CFString for this key.
        let key = unsafe { CFString::wrap_under_get_rule(kSecCodeInfoUnique) };
        let hash = info
            .find(&key)
            .and_then(|value| value.downcast::<CFData>())
            .ok_or("missing image CDHash")?;
        if hash.bytes().len() != 20 {
            return Err("unsupported image CDHash".into());
        }
        Ok(hash.bytes().to_vec())
    }

    fn message(error: impl std::fmt::Display) -> String {
        format!("invalid authorized code signature: {error}")
    }
}

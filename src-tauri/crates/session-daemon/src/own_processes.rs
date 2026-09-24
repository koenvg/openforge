#[cfg(target_os = "macos")]
pub(crate) fn ids() -> std::io::Result<Vec<libc::pid_t>> {
    const PROC_UID_ONLY: u32 = 4;
    // SAFETY: geteuid reads the effective UID without dereferencing pointers.
    let uid = unsafe { libc::geteuid() };
    let list = |buffer: &mut [libc::pid_t]| -> std::io::Result<usize> {
        let bytes = std::mem::size_of_val(buffer) as libc::c_int;
        // SAFETY: the buffer is writable for `bytes` bytes, or null with size zero.
        let filled = unsafe {
            libc::proc_listpids(
                PROC_UID_ONLY,
                uid,
                if buffer.is_empty() {
                    std::ptr::null_mut()
                } else {
                    buffer.as_mut_ptr().cast()
                },
                bytes,
            )
        };
        if filled < 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(filled as usize / std::mem::size_of::<libc::pid_t>())
    };
    let mut capacity = list(&mut [])? + 64;
    loop {
        let mut pids = vec![0; capacity];
        let count = list(&mut pids)?;
        let may_be_truncated = count == capacity;
        if !may_be_truncated {
            pids.truncate(count);
            pids.retain(|pid| *pid > 0);
            return Ok(pids);
        }
        capacity *= 2;
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn ids() -> std::io::Result<Vec<libc::pid_t>> {
    let mut system = sysinfo::System::new();
    system.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing().with_user(sysinfo::UpdateKind::Always),
    );
    // SAFETY: geteuid reads the effective UID without dereferencing pointers.
    let uid = sysinfo::Uid::try_from(unsafe { libc::geteuid() } as usize)
        .map_err(|_| std::io::Error::other("invalid effective uid"))?;
    Ok(system
        .processes()
        .iter()
        .filter(|(_, process)| process.user_id() == Some(&uid))
        .map(|(pid, _)| pid.as_u32() as libc::pid_t)
        .collect())
}

#[cfg(test)]
mod tests {
    #[test]
    fn includes_this_process_and_its_children() {
        let mut child = std::process::Command::new("sleep")
            .arg("5")
            .spawn()
            .unwrap();
        let ids = super::ids().unwrap();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(ids.contains(&(std::process::id() as libc::pid_t)));
        assert!(ids.contains(&(child.id() as libc::pid_t)));
    }
}

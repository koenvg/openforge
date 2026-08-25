use rusqlite::types::ToSql;

pub(super) struct SqliteIdList<'a> {
    pub(super) placeholders: String,
    pub(super) params: Vec<&'a dyn ToSql>,
}

pub(super) fn sqlite_id_list(ids: &[i64]) -> Option<SqliteIdList<'_>> {
    if ids.is_empty() {
        return None;
    }

    let placeholders = (1..=ids.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let params = ids.iter().map(|id| id as &dyn ToSql).collect();

    Some(SqliteIdList {
        placeholders,
        params,
    })
}

#[cfg(test)]
mod tests {
    use super::sqlite_id_list;

    #[test]
    fn id_list_is_absent_for_empty_ids() {
        assert!(sqlite_id_list(&[]).is_none());
    }

    #[test]
    fn id_list_builds_placeholders_and_parameters_for_ids() {
        let id_list = sqlite_id_list(&[7, 11]).expect("non-empty IDs should build a list");
        assert_eq!(id_list.placeholders, "?1, ?2");

        let connection = rusqlite::Connection::open_in_memory().expect("open SQLite database");
        let sql = format!(
            "SELECT COUNT(*) FROM (SELECT 7 AS id UNION ALL SELECT 11) WHERE id IN ({})",
            id_list.placeholders
        );
        let count: i64 = connection
            .query_row(&sql, id_list.params.as_slice(), |row| row.get(0))
            .expect("query with ID-list parameters");

        assert_eq!(count, 2);
    }
}

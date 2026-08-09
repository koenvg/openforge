use crate::project_board::ProjectBoardProjection;
use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

const PROJECT_SIDEBAR_ORDER_CONFIG_KEY: &str = "project_sidebar_order";
const HIDDEN_PROJECTS_CONFIG_KEY: &str = "project_sidebar_hidden";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompanionProject {
    pub(crate) project_id: String,
    pub(crate) name: String,
}

pub(crate) trait CompanionProjectBoardSource: Send + Sync {
    fn catalog(&self) -> Result<Vec<CompanionProject>, String>;
    fn is_project_visible(&self, project_id: &str) -> Result<bool, String>;
    fn board(&self, project_id: &str) -> Result<Option<ProjectBoardProjection>, String>;
}

#[derive(Clone)]
pub(crate) struct DatabaseCompanionProjectBoardSource {
    database: Arc<Mutex<crate::db::Database>>,
}

impl DatabaseCompanionProjectBoardSource {
    pub(crate) fn new(database: Arc<Mutex<crate::db::Database>>) -> Self {
        Self { database }
    }
}

impl CompanionProjectBoardSource for DatabaseCompanionProjectBoardSource {
    fn catalog(&self) -> Result<Vec<CompanionProject>, String> {
        let database = self
            .database
            .lock()
            .map_err(|_| "Companion Project catalog database lock was poisoned".to_string())?;
        visible_project_catalog(&database)
    }

    fn is_project_visible(&self, project_id: &str) -> Result<bool, String> {
        let database = self
            .database
            .lock()
            .map_err(|_| "Companion Project visibility database lock was poisoned".to_string())?;
        Ok(visible_project_catalog(&database)?
            .iter()
            .any(|project| project.project_id == project_id))
    }
    fn board(&self, project_id: &str) -> Result<Option<ProjectBoardProjection>, String> {
        let database = self
            .database
            .lock()
            .map_err(|_| "Companion Project Board database lock was poisoned".to_string())?;
        if !visible_project_catalog(&database)?
            .iter()
            .any(|project| project.project_id == project_id)
        {
            return Ok(None);
        }
        database
            .get_project_board(project_id)
            .map_err(|error| format!("failed to project Companion Project Board: {error}"))
    }
}

fn parse_string_list(raw: Option<String>) -> Option<Vec<String>> {
    serde_json::from_str::<Vec<String>>(raw.as_deref()?).ok()
}

fn visible_project_catalog(
    database: &crate::db::Database,
) -> Result<Vec<CompanionProject>, String> {
    let projects = database
        .get_all_projects()
        .map_err(|error| format!("failed to read Companion Projects: {error}"))?;
    let saved_order = parse_string_list(
        database
            .get_config(PROJECT_SIDEBAR_ORDER_CONFIG_KEY)
            .map_err(|error| format!("failed to read Companion Project order: {error}"))?,
    );
    let hidden = parse_string_list(
        database
            .get_config(HIDDEN_PROJECTS_CONFIG_KEY)
            .map_err(|error| format!("failed to read Companion Project visibility: {error}"))?,
    )
    .unwrap_or_default()
    .into_iter()
    .collect::<HashSet<_>>();
    let mut ordered = Vec::with_capacity(projects.len());
    let mut seen = HashSet::new();

    if let Some(saved_order) = saved_order {
        for project_id in saved_order {
            if seen.insert(project_id.clone()) {
                if let Some(project) = projects.iter().find(|project| project.id == project_id) {
                    ordered.push(project);
                }
            }
        }
    }
    for project in &projects {
        if seen.insert(project.id.clone()) {
            ordered.push(project);
        }
    }

    Ok(ordered
        .into_iter()
        .filter(|project| !hidden.contains(&project.id))
        .map(|project| CompanionProject {
            project_id: project.id.clone(),
            name: project.name.clone(),
        })
        .collect())
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct UnavailableCompanionProjectBoardSource;

#[cfg(test)]
impl CompanionProjectBoardSource for UnavailableCompanionProjectBoardSource {
    fn catalog(&self) -> Result<Vec<CompanionProject>, String> {
        Err("Companion Project catalog is unavailable".to_string())
    }

    fn is_project_visible(&self, _project_id: &str) -> Result<bool, String> {
        Ok(true)
    }
    fn board(&self, _project_id: &str) -> Result<Option<ProjectBoardProjection>, String> {
        Err("Companion Project Board is unavailable".to_string())
    }
}

use std::{collections::HashSet, sync::OnceLock};

use serde::{Deserialize, Serialize};

use super::action_palette::{
    CompanionActionPaletteError, CompanionProjectActionId, CompanionTaskActionId,
};

const PRESENTATION_CONTRACT: &str =
    include_str!("../../../docs/contracts/action-palette-presentation.json");

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CompanionActionIcon {
    Play,
    Merge,
    Queue,
    Visibility,
    Delete,
    Complete,
    VisibilityOff,
    Rocket,
    Refresh,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CompanionActionPresentation<ActionId> {
    pub(crate) id: ActionId,
    #[serde(skip_serializing)]
    desktop_id: String,
    pub(crate) label: String,
    pub(crate) keywords: Vec<String>,
    pub(crate) icon: CompanionActionIcon,
    pub(crate) requires_confirmation: bool,
    pub(crate) destructive: bool,
}

pub(crate) type CompanionTaskActionPresentation =
    CompanionActionPresentation<CompanionTaskActionId>;
pub(crate) type CompanionProjectActionPresentation =
    CompanionActionPresentation<CompanionProjectActionId>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionPresentationContract {
    task_actions: Vec<CompanionTaskActionPresentation>,
    project_actions: Vec<CompanionProjectActionPresentation>,
}

static PRESENTATIONS: OnceLock<Result<ActionPresentationContract, String>> = OnceLock::new();

fn presentations() -> Result<&'static ActionPresentationContract, CompanionActionPaletteError> {
    PRESENTATIONS
        .get_or_init(|| {
            serde_json::from_str(PRESENTATION_CONTRACT)
                .map_err(|error| format!("invalid Action Palette presentation contract: {error}"))
        })
        .as_ref()
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)
}

fn select_presentations<ActionId>(
    available: &[ActionId],
    canonical: &[CompanionActionPresentation<ActionId>],
) -> Result<Vec<CompanionActionPresentation<ActionId>>, CompanionActionPaletteError>
where
    ActionId: Copy + Eq + std::hash::Hash,
{
    let available = available.iter().copied().collect::<HashSet<_>>();
    let selected = canonical
        .iter()
        .filter(|presentation| available.contains(&presentation.id))
        .cloned()
        .collect::<Vec<_>>();

    if selected.len() != available.len() {
        return Err(CompanionActionPaletteError::TemporarilyUnavailable);
    }
    Ok(selected)
}

pub(crate) fn task_action_presentations(
    available: &[CompanionTaskActionId],
) -> Result<Vec<CompanionTaskActionPresentation>, CompanionActionPaletteError> {
    select_presentations(available, &presentations()?.task_actions)
}

pub(crate) fn project_action_presentations(
    available: &[CompanionProjectActionId],
) -> Result<Vec<CompanionProjectActionPresentation>, CompanionActionPaletteError> {
    select_presentations(available, &presentations()?.project_actions)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checked_in_contract_covers_every_shared_action_once() {
        let contract = presentations().expect("valid presentation contract");
        let task_ids = contract
            .task_actions
            .iter()
            .map(|action| action.id)
            .collect::<HashSet<_>>();
        let project_ids = contract
            .project_actions
            .iter()
            .map(|action| action.id)
            .collect::<HashSet<_>>();

        assert_eq!(task_ids.len(), contract.task_actions.len());
        assert_eq!(task_ids.len(), 8);
        assert_eq!(project_ids.len(), contract.project_actions.len());
        assert_eq!(project_ids.len(), 1);
        assert!(contract
            .task_actions
            .iter()
            .any(|action| action.id == CompanionTaskActionId::ReturnToBoard
                && action.label == "Return to Board"));
    }
}

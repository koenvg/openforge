import type { Project } from './types'

export interface ProjectIdentity {
  projectName: string
  projectPath: string
}

interface UpdatedProjectIdentity {
  id: string
  name: string
  path: string
}

export function getProjectIdentity(projectId: string | null, projectList: Project[]): ProjectIdentity {
  if (!projectId) {
    return {
      projectName: '',
      projectPath: '',
    }
  }

  const project = projectList.find((candidate) => candidate.id === projectId)

  return {
    projectName: project?.name ?? '',
    projectPath: project?.path ?? '',
  }
}

export function mergeUpdatedProject(projectList: Project[], updatedProject: UpdatedProjectIdentity): Project[] {
  return projectList.map((project) =>
    project.id === updatedProject.id
      ? { ...project, name: updatedProject.name, path: updatedProject.path }
      : project
  )
}

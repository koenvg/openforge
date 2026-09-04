import packageMetadataSchemaData from './openforgePackageMetadataSchema.json' with { type: 'json' }
import { isPluginIconName, isPluginSvgIcon } from './pluginIconContract.js'
import type { OpenForgePackageMetadata, OpenForgePluginCapability, ValidationError } from './types.js'
import { SUPPORTED_OPENFORGE_API_VERSIONS } from './types.js'

export const OPENFORGE_PACKAGE_METADATA_SCHEMA = packageMetadataSchemaData

export const OPENFORGE_PLUGIN_CAPABILITIES = packageMetadataSchemaData.properties.requires.items.enum as readonly OpenForgePluginCapability[]

const CAPABILITIES = new Set<string>(OPENFORGE_PLUGIN_CAPABILITIES)

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validateRequiredString(value: unknown, path: string): ValidationError[] {
  if (!isNonEmptyString(value)) {
    return [{ path, message: 'Required string' }]
  }
  return []
}

function validateOptionalString(value: unknown, path: string): ValidationError[] {
  if (value === undefined) {
    return []
  }
  if (!isNonEmptyString(value)) {
    return [{ path, message: 'Must be a non-empty string' }]
  }
  return []
}

function validateBackendEntry(value: unknown): ValidationError[] {
  const errors = validateOptionalString(value, 'backend')
  if (!isNonEmptyString(value)) return errors
  if (!['.mjs', '.js', '.cjs'].some(extension => value.endsWith(extension))) {
    errors.push({ path: 'backend', message: 'Must point to a built .mjs, .js, or .cjs artifact' })
  }
  return errors
}

function validateEnablement(value: unknown): ValidationError[] {
  if (value === undefined || value === 'app' || value === 'project') {
    return []
  }
  return [{ path: 'enablement', message: 'Must be "app" or "project"' }]
}

function validatePluginIcon(value: unknown): ValidationError[] {
  if (value === undefined || isPluginIconName(value) || isPluginSvgIcon(value)) {
    return []
  }
  return [{ path: 'icon', message: 'Must be a non-empty Lucide icon name or { type: "svg", svg }' }]
}

function validateFrontendStyles(value: unknown): ValidationError[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    return [{ path: 'frontendStyles', message: 'Must be an array' }]
  }

  const errors: ValidationError[] = []
  if (value.length === 0) {
    errors.push({ path: 'frontendStyles', message: 'Must contain at least one stylesheet path' })
  }
  const seen = new Set<string>()
  value.forEach((item, index) => {
    if (!isNonEmptyString(item)) {
      errors.push({ path: `frontendStyles[${index}]`, message: 'Must be a non-empty string' })
    } else if (!item.endsWith('.css')) {
      errors.push({ path: `frontendStyles[${index}]`, message: 'Must point to a built CSS artifact' })
    } else if (seen.has(item)) {
      errors.push({ path: `frontendStyles[${index}]`, message: 'Duplicate stylesheet path' })
    } else {
      seen.add(item)
    }
  })
  return errors
}

export function isSupportedOpenForgeApiVersion(apiVersion: unknown): apiVersion is (typeof SUPPORTED_OPENFORGE_API_VERSIONS)[number] {
  return typeof apiVersion === 'number'
    && Number.isInteger(apiVersion)
    && (SUPPORTED_OPENFORGE_API_VERSIONS as readonly number[]).includes(apiVersion)
}

function validateApiVersion(value: unknown): ValidationError[] {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [{ path: 'apiVersion', message: 'Required integer' }]
  }

  if (!isSupportedOpenForgeApiVersion(value)) {
    return [{ path: 'apiVersion', message: `API version ${value} not supported (supported: ${SUPPORTED_OPENFORGE_API_VERSIONS.join(', ')})` }]
  }

  return []
}

function validateRequires(value: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (value === undefined) {
    return errors
  }

  if (!Array.isArray(value)) {
    return [{ path: 'requires', message: 'Must be an array' }]
  }

  value.forEach((item, index) => {
    const path = `requires[${index}]`
    if (!isString(item)) {
      errors.push({ path, message: 'Must be a string' })
      return
    }

    if (!CAPABILITIES.has(item)) {
      errors.push({ path, message: `Unknown OpenForge capability "${item}"` })
    }
  })

  return errors
}

export function validateOpenForgePackageMetadata(data: unknown): ValidationError[] {
  const errors: ValidationError[] = []

  if (!isObject(data)) {
    return [{ path: '', message: 'OpenForge package metadata must be an object' }]
  }

  errors.push(...validateRequiredString(data.id, 'id'))
  errors.push(...validateApiVersion(data.apiVersion))
  errors.push(...validateRequiredString(data.displayName, 'displayName'))
  errors.push(...validateRequiredString(data.description, 'description'))
  errors.push(...validateEnablement(data.enablement))
  errors.push(...validatePluginIcon(data.icon))
  errors.push(...validateOptionalString(data.frontend, 'frontend'))
  errors.push(...validateFrontendStyles(data.frontendStyles))
  if (data.frontendStyles !== undefined && !isNonEmptyString(data.frontend)) {
    errors.push({ path: 'frontendStyles', message: 'Requires a frontend entry' })
  }
  errors.push(...validateBackendEntry(data.backend))
  errors.push(...validateRequires(data.requires))
  if (data.enablement === 'app' && (!Array.isArray(data.requires) || !data.requires.includes('appEnablement'))) {
    errors.push({ path: 'requires', message: 'App enablement requires the appEnablement capability' })
  }
  if (Array.isArray(data.requires) && data.requires.includes('themes')) {
    if (data.enablement !== 'app') {
      errors.push({ path: 'enablement', message: 'themes capability requires app enablement' })
    }
    if (!isNonEmptyString(data.frontend)) {
      errors.push({ path: 'requires', message: 'themes capability requires a frontend entry' })
    }
  }
  if (Array.isArray(data.requires) && data.requires.includes('browserSurfaces') && !isNonEmptyString(data.frontend)) {
    errors.push({ path: 'requires', message: 'browserSurfaces capability requires a frontend entry' })
  }
  if (Array.isArray(data.requires) && data.requires.includes('viewReplacements') && !isNonEmptyString(data.frontend)) {
    errors.push({ path: 'requires', message: 'viewReplacements capability requires a frontend entry' })
  }

  if (data.contributes !== undefined) {
    errors.push({ path: 'contributes', message: 'Manifest contribution arrays are not supported; register contributions at runtime' })
  }

  for (const key of Object.keys(data)) {
    if (!Object.prototype.hasOwnProperty.call(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties, key)) {
      if (key !== 'contributes') {
        errors.push({ path: key, message: 'Unknown OpenForge package metadata field' })
      }
    }
  }

  return errors
}

export const validatePluginPackageMetadata = validateOpenForgePackageMetadata

export function isOpenForgePackageMetadata(data: unknown): data is OpenForgePackageMetadata {
  return validateOpenForgePackageMetadata(data).length === 0
}

export const isPluginPackageMetadata = isOpenForgePackageMetadata

import { html, nothing } from "lit";
import { icons } from "../icons.ts";
import type { ConfigUiHints } from "../types.ts";
import { renderNode } from "./config-form.node.ts";
import { hintForPath, humanize, schemaType, type JsonSchema } from "./config-form.shared.ts";
import { localizeConfigHelp, localizeConfigText } from "./config-localization.ts";
import {
  CONFIG_SECTION_META,
  renderConfigSectionIcon,
  resolveConfigSectionMeta,
} from "./config-sections.ts";

export type ConfigFormProps = {
  schema: JsonSchema | null;
  uiHints: ConfigUiHints;
  value: Record<string, unknown> | null;
  disabled?: boolean;
  unsupportedPaths?: string[];
  searchQuery?: string;
  activeSection?: string | null;
  activeSubsection?: string | null;
  onPatch: (path: Array<string | number>, value: unknown) => void;
};

export const SECTION_META = CONFIG_SECTION_META;

const MINIMAL_OPEN_SECTION_KEYS = new Set(["agents", "auth", "channels", "gateway"]);

function shouldOpenSectionCard(params: {
  sectionKey: string;
  activeSection?: string | null;
  searchQuery?: string;
}): boolean {
  if (params.searchQuery) {
    return true;
  }
  if (params.activeSection && params.sectionKey === params.activeSection) {
    return true;
  }
  return MINIMAL_OPEN_SECTION_KEYS.has(params.sectionKey);
}

function matchesSearch(key: string, schema: JsonSchema, query: string): boolean {
  if (!query) {
    return true;
  }
  const q = query.toLowerCase();
  const meta = SECTION_META[key];

  // Check key name
  if (key.toLowerCase().includes(q)) {
    return true;
  }

  // Check label and description
  if (meta) {
    if (meta.label.toLowerCase().includes(q)) {
      return true;
    }
    if (meta.description.toLowerCase().includes(q)) {
      return true;
    }
  }

  return schemaMatches(schema, q);
}

function schemaMatches(schema: JsonSchema, query: string): boolean {
  if (schema.title?.toLowerCase().includes(query)) {
    return true;
  }
  if (schema.description?.toLowerCase().includes(query)) {
    return true;
  }
  if (schema.enum?.some((value) => String(value).toLowerCase().includes(query))) {
    return true;
  }

  if (schema.properties) {
    for (const [propKey, propSchema] of Object.entries(schema.properties)) {
      if (propKey.toLowerCase().includes(query)) {
        return true;
      }
      if (schemaMatches(propSchema, query)) {
        return true;
      }
    }
  }

  if (schema.items) {
    const items = Array.isArray(schema.items) ? schema.items : [schema.items];
    for (const item of items) {
      if (item && schemaMatches(item, query)) {
        return true;
      }
    }
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    if (schemaMatches(schema.additionalProperties, query)) {
      return true;
    }
  }

  const unions = schema.anyOf ?? schema.oneOf ?? schema.allOf;
  if (unions) {
    for (const entry of unions) {
      if (entry && schemaMatches(entry, query)) {
        return true;
      }
    }
  }

  return false;
}

export function renderConfigForm(props: ConfigFormProps) {
  if (!props.schema) {
    return html`
      <div class="muted">配置结构不可用。</div>
    `;
  }
  const schema = props.schema;
  const value = props.value ?? {};
  if (schemaType(schema) !== "object" || !schema.properties) {
    return html`
      <div class="callout danger">不支持该配置结构，请改用“原始”模式。</div>
    `;
  }
  const unsupported = new Set(props.unsupportedPaths ?? []);
  const properties = schema.properties;
  const searchQuery = props.searchQuery ?? "";
  const activeSection = props.activeSection;
  const activeSubsection = props.activeSubsection ?? null;

  const entries = Object.entries(properties).toSorted((a, b) => {
    const orderA = hintForPath([a[0]], props.uiHints)?.order ?? 50;
    const orderB = hintForPath([b[0]], props.uiHints)?.order ?? 50;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a[0].localeCompare(b[0]);
  });

  const filteredEntries = entries.filter(([key, node]) => {
    if (activeSection && key !== activeSection) {
      return false;
    }
    if (searchQuery && !matchesSearch(key, node, searchQuery)) {
      return false;
    }
    return true;
  });

  let subsectionContext: { sectionKey: string; subsectionKey: string; schema: JsonSchema } | null =
    null;
  if (activeSection && activeSubsection && filteredEntries.length === 1) {
    const sectionSchema = filteredEntries[0]?.[1];
    if (
      sectionSchema &&
      schemaType(sectionSchema) === "object" &&
      sectionSchema.properties &&
      sectionSchema.properties[activeSubsection]
    ) {
      subsectionContext = {
        sectionKey: activeSection,
        subsectionKey: activeSubsection,
        schema: sectionSchema.properties[activeSubsection],
      };
    }
  }

  if (filteredEntries.length === 0) {
    return html`
      <div class="config-empty">
        <div class="config-empty__icon">${icons.search}</div>
        <div class="config-empty__text">
          ${searchQuery ? `没有匹配“${searchQuery}”的设置项` : "该分组暂无可展示设置项"}
        </div>
      </div>
    `;
  }

  return html`
    <div class="config-form config-form--modern">
      ${
        subsectionContext
          ? (() => {
              const { sectionKey, subsectionKey, schema: node } = subsectionContext;
              const hint = hintForPath([sectionKey, subsectionKey], props.uiHints);
              const label = localizeConfigText(
                hint?.label ?? node.title ?? humanize(subsectionKey),
                subsectionKey,
              );
              const description = localizeConfigHelp(hint?.help ?? node.description, subsectionKey);
              const sectionValue = value[sectionKey];
              const scopedValue =
                sectionValue && typeof sectionValue === "object"
                  ? (sectionValue as Record<string, unknown>)[subsectionKey]
                  : undefined;
              const id = `config-section-${sectionKey}-${subsectionKey}`;
              return html`
              <section class="config-section-card" id=${id}>
                <div class="config-section-card__header">
                  <span class="config-section-card__icon">${renderConfigSectionIcon(sectionKey)}</span>
                  <div class="config-section-card__titles">
                    <h3 class="config-section-card__title">${label}</h3>
                    ${
                      description
                        ? html`<p class="config-section-card__desc">${description}</p>`
                        : nothing
                    }
                  </div>
                </div>
                <div class="config-section-card__content">
                  ${renderNode({
                    schema: node,
                    value: scopedValue,
                    path: [sectionKey, subsectionKey],
                    hints: props.uiHints,
                    unsupported,
                    disabled: props.disabled ?? false,
                    showLabel: false,
                    onPatch: props.onPatch,
                  })}
                </div>
              </section>
            `;
            })()
          : filteredEntries.map(([key, node]) => {
              const meta = resolveConfigSectionMeta(key, node);
              const openByDefault = shouldOpenSectionCard({
                sectionKey: key,
                activeSection,
                searchQuery,
              });

              return html`
              <details
                class="config-section-card config-section-card--collapsible"
                id="config-section-${key}"
                ?open=${openByDefault}
              >
                <summary class="config-section-card__header config-section-card__header--summary">
                  <span class="config-section-card__icon">${renderConfigSectionIcon(key)}</span>
                  <div class="config-section-card__titles">
                    <h3 class="config-section-card__title">${meta.label}</h3>
                    ${
                      meta.description
                        ? html`<p class="config-section-card__desc">${meta.description}</p>`
                        : nothing
                    }
                  </div>
                  <span class="config-section-card__chevron">${icons.arrowDown}</span>
                </summary>
                <div class="config-section-card__content">
                  ${renderNode({
                    schema: node,
                    value: value[key],
                    path: [key],
                    hints: props.uiHints,
                    unsupported,
                    disabled: props.disabled ?? false,
                    showLabel: false,
                    onPatch: props.onPatch,
                  })}
                </div>
              </details>
            `;
            })
      }
    </div>
  `;
}

import { describe, expect, it } from "vitest";
import { buildLinkTree, type LinkTreeNode } from "./link-tree";
import {
  VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID,
  VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL,
} from "./constants";
import type { LinkRecord } from "./types";

const freeGroupId = "free-links-source-outside-data-repo";
const freeGroupLabel = "自由链接(源不在 Data Repo)";

function link(overrides: Partial<LinkRecord> & Pick<LinkRecord, "id" | "label" | "source" | "target">): LinkRecord {
  return {
    groupId: freeGroupId,
    groupLabel: freeGroupLabel,
    kind: "directory",
    sourceConfig: overrides.source,
    dataRepoId: null,
    status: "enabled",
    sourceExists: true,
    targetExists: true,
    currentTarget: overrides.source,
    isFreeLink: true,
    notes: [],
    ...overrides,
  };
}

function leafLinkIds(nodes: LinkTreeNode[]): string[] {
  const ids: string[] = [];
  const visit = (node: LinkTreeNode) => {
    if (node.link) ids.push(node.link.id);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

describe("free-link source tree", () => {
  it("keeps multiple mappings that share the same source directory", () => {
    const links = [
      link({
        id: "external-anki2",
        label: "Anki2",
        source: "D:/A/Scoop/persist/anki/data",
        target: "C:/Users/i/AppData/Roaming/Anki2",
      }),
      link({
        id: "external-espanso",
        label: "espanso",
        source: "D:/A/Scoop/persist/Espanso/.espanso",
        target: "C:/Users/i/AppData/Roaming/espanso",
      }),
      link({
        id: "link-two-scoop-espanso",
        label: "连接 scoop 中的两个espanso数据",
        source: "D:/A/Scoop/persist/Espanso/.espanso",
        target: "D:/A/Scoop/persist/espanso-portable/.espanso",
      }),
    ];

    const [group] = buildLinkTree(links, "source", []);
    const persistNode = group.nodes.find((node) => node.path.toLowerCase() === "d:\\a\\scoop\\persist");
    const ids = leafLinkIds(group.nodes).sort();

    expect(group.statusCounts.enabled).toBe(3);
    expect(persistNode?.links).toHaveLength(3);
    expect(ids).toEqual(["external-anki2", "external-espanso", "link-two-scoop-espanso"]);
  });
});

describe("independent Mapping Root source tree", () => {
  it("shows independent Mapping Roots before their generated mappings in the virtual Data Repo group", () => {
    const rootSource = "D:/A/Scoop/persist";
    const childSource = "D:/A/Scoop/persist/Tool";
    const [group] = buildLinkTree(
      [
        link({
          id: "external-tools::Tool",
          label: "External Tools / Tool",
          groupId: VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID,
          groupLabel: VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL,
          source: childSource,
          target: "C:/Users/i/AppData/Roaming/Tool",
          dataRepoId: VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID,
          isFreeLink: false,
        }),
      ],
      "source",
      [
        {
          id: "external-tools",
          label: "External Tools",
          dataRepoId: VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID,
          source: rootSource,
          resolvedSource: rootSource,
          target: "%APPDATA%",
          resolvedTarget: "C:/Users/i/AppData/Roaming",
          mode: "children",
          enabled: true,
          ignore: [],
        },
      ],
    );

    expect(group.id).toBe(VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID);
    expect(group.label).toBe(VIRTUAL_INDEPENDENT_MAPPING_ROOTS_LABEL);
    expect(group.nodes).toHaveLength(1);
    expect(group.nodes[0].mappingRoot?.id).toBe("external-tools");
    expect(group.nodes[0].link).toBeUndefined();
    expect(group.nodes[0].children[0].link?.id).toBe("external-tools::Tool");
    expect(leafLinkIds(group.nodes)).toEqual(["external-tools::Tool"]);
  });
});

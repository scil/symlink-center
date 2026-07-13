import { VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID } from "./constants";
import type { LinkRecord, LinkSettings, LinkStatus } from "./types";

export type LinkTreeGroup = {
  id: string;
  label: string;
  sortPath: string;
  links: LinkRecord[];
  nodes: LinkTreeNode[];
  statusCounts: Partial<Record<LinkStatus, number>>;
};

export type LinkTreeNode = {
  id: string;
  name: string;
  path: string;
  depth: number;
  links: LinkRecord[];
  statusCounts: Partial<Record<LinkStatus, number>>;
  children: LinkTreeNode[];
  link?: LinkRecord;
  mappingRoot?: LinkSettings["mappingRoots"][number];
};

export type LinkTreeMode = "target" | "source";

type FreeLinkTrieNode = {
  part: string;
  path: string;
  links: LinkRecord[];
  statusCounts: Partial<Record<LinkStatus, number>>;
  children: Map<string, FreeLinkTrieNode>;
  terminalLinks: LinkRecord[];
};

export function buildLinkTree(
  links: LinkRecord[],
  mode: LinkTreeMode,
  mappingRoots: LinkSettings["mappingRoots"],
): LinkTreeGroup[] {
  const groups = new Map<string, LinkTreeGroup>();
  for (const link of links) {
    const id = link.groupId || "ungrouped";
    const label = link.groupLabel || "未分组";
    let group = groups.get(id);
    if (!group) {
      group = { id, label, sortPath: "", links: [], nodes: [], statusCounts: {} };
      groups.set(id, group);
    }
    group.links.push(link);
    group.statusCounts[link.status] = (group.statusCounts[link.status] ?? 0) + 1;
  }

  return Array.from(groups.values())
    .map((group) => {
      const links = [...group.links].sort((a, b) => compareLinksByHierarchy(a, b, mode));
      const basePath = commonParentPath(links.map((link) => pathForTreeMode(link, mode)));
      return {
        ...group,
        sortPath: basePath,
        links,
        nodes: buildLinkTreeNodes(links, basePath, mode, group.id, mappingRoots),
      };
    })
    .sort(compareGroupsByHierarchy);
}

export function collectExpandableNodeIds(groups: LinkTreeGroup[]) {
  const ids = new Set<string>();
  const visit = (node: LinkTreeNode) => {
    if (node.children.length > 0) ids.add(node.id);
    node.children.forEach(visit);
  };
  groups.forEach((group) => group.nodes.forEach(visit));
  return ids;
}

function buildLinkTreeNodes(
  links: LinkRecord[],
  basePath: string,
  mode: LinkTreeMode,
  groupId: string,
  mappingRoots: LinkSettings["mappingRoots"],
) {
  const root: LinkTreeNode = {
    id: `${mode}:root`,
    name: "",
    path: basePath,
    depth: 0,
    links: [],
    statusCounts: {},
    children: [],
  };

  if (mode === "source" && isFreeLinkGroup(groupId)) {
    return buildFreeLinkSourceTreeNodes(links);
  }

  if (mode === "source" && groupId === VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID) {
    return buildVirtualDataRepoSourceTreeNodes(links, mappingRoots);
  }

  for (const link of links) {
    const linkPath = pathForTreeMode(link, mode);
    const parts = relativePathParts(linkPath, basePath);
    const targetParts = parts.length ? parts : [link.label];
    let cursor = root;

    for (const part of targetParts) {
      let child = cursor.children.find((node) => node.name === part);
      if (!child) {
        const path = joinSortPath(cursor.path, part);
        child = {
          id: `${mode}:dir:${path}`,
          name: part,
          path,
          depth: cursor.depth + 1,
          links: [],
          statusCounts: {},
          children: [],
        };
        cursor.children.push(child);
      }
      cursor = child;
      cursor.links.push(link);
      cursor.statusCounts[link.status] = (cursor.statusCounts[link.status] ?? 0) + 1;
    }

    cursor.id = `${mode}:node:${link.id}:${linkPath}`;
    cursor.path = linkPath;
    cursor.link = link;
  }

  sortTreeNodes(root.children);
  if (mode === "source") {
    attachMappingRoots(root.children, groupId, mappingRoots);
  }
  return root.children;
}

function buildVirtualDataRepoSourceTreeNodes(
  links: LinkRecord[],
  mappingRoots: LinkSettings["mappingRoots"],
) {
  const roots = mappingRoots
    .filter((root) => (root.dataRepoId ?? "primary") === VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID)
    .sort((a, b) => comparePathsByHierarchy(a.resolvedSource, b.resolvedSource) || a.label.localeCompare(b.label));
  const matchedLinkIds = new Set<string>();

  const nodes: LinkTreeNode[] = roots.flatMap((root) => {
    const rootLinks = links.filter((link) => linkBelongsToMappingRoot(link, root));
    if (rootLinks.length === 0) return [];
    rootLinks.forEach((link) => matchedLinkIds.add(link.id));

    const childLinks = rootLinks.filter((link) => !pathsSameForUi(link.source, root.resolvedSource));
    const children = buildLinkTreeNodes(
      [...childLinks].sort((a, b) => compareLinksByHierarchy(a, b, "source")),
      root.resolvedSource,
      "source",
      `${VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID}:children`,
      [],
    );

    return [
      {
        id: `source:virtual-mapping-root:${root.id}:${root.resolvedSource}`,
        name: root.label,
        path: root.resolvedSource,
        depth: 0,
        links: rootLinks,
        statusCounts: statusCountsForLinks(rootLinks),
        children,
        mappingRoot: root,
      },
    ];
  });

  const unmatchedLinks = links.filter((link) => !matchedLinkIds.has(link.id));
  if (unmatchedLinks.length > 0) {
    const children = buildLinkTreeNodes(
      [...unmatchedLinks].sort((a, b) => compareLinksByHierarchy(a, b, "source")),
      commonParentPath(unmatchedLinks.map((link) => link.source)),
      "source",
      `${VIRTUAL_INDEPENDENT_MAPPING_ROOTS_ID}:unmatched`,
      [],
    );
    nodes.push({
      id: "source:virtual-mapping-root:unmatched",
      name: "未归属独立 Mapping Root",
      path: "",
      depth: 0,
      links: unmatchedLinks,
      statusCounts: statusCountsForLinks(unmatchedLinks),
      children,
    });
  }

  sortTreeNodes(nodes);
  return nodes;
}

function linkBelongsToMappingRoot(
  link: LinkRecord,
  mappingRoot: LinkSettings["mappingRoots"][number],
) {
  return (
    link.id === mappingRoot.id ||
    link.id.startsWith(`${mappingRoot.id}::`) ||
    pathInsideOrSameForUi(link.source, mappingRoot.resolvedSource)
  );
}

function statusCountsForLinks(links: LinkRecord[]) {
  return links.reduce<Partial<Record<LinkStatus, number>>>((counts, link) => {
    counts[link.status] = (counts[link.status] ?? 0) + 1;
    return counts;
  }, {});
}

function pathInsideOrSameForUi(path: string, root: string) {
  const normalizedPath = normalizePathForSort(path);
  const normalizedRoot = normalizePathForSort(root);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`);
}

const minFreeLinkGroupParts = 3;

function buildFreeLinkSourceTreeNodes(links: LinkRecord[]) {
  const root: FreeLinkTrieNode = {
    part: "",
    path: "",
    links: [],
    statusCounts: {},
    children: new Map(),
    terminalLinks: [],
  };

  for (const link of links) {
    const parts = splitPathParts(link.source);
    let cursor = root;
    cursor.links.push(link);
    cursor.statusCounts[link.status] = (cursor.statusCounts[link.status] ?? 0) + 1;

    for (const part of parts.length ? parts : [freeLinkNodeName(link)]) {
      const path = joinSortPath(cursor.path, part);
      let child = cursor.children.get(part);
      if (!child) {
        child = {
          part,
          path,
          links: [],
          statusCounts: {},
          children: new Map(),
          terminalLinks: [],
        };
        cursor.children.set(part, child);
      }
      cursor = child;
      cursor.links.push(link);
      cursor.statusCounts[link.status] = (cursor.statusCounts[link.status] ?? 0) + 1;
    }

    cursor.terminalLinks.push(link);
  }

  const nodes = Array.from(root.children.values()).flatMap((child) => compressFreeLinkTrieNode(child, 0));
  sortTreeNodes(nodes);
  return nodes;
}

function compressFreeLinkTrieNode(node: FreeLinkTrieNode, depth: number): LinkTreeNode[] {
  const parts = [node.part];
  let cursor = node;

  while (cursor.terminalLinks.length === 0 && cursor.children.size === 1) {
    const child = Array.from(cursor.children.values())[0];
    parts.push(child.part);
    cursor = child;
  }

  if (cursor.terminalLinks.length > 0 && cursor.children.size === 0) {
    return freeLinkLeafNodes(cursor.terminalLinks, depth, depth === 0 ? undefined : parts.join("\\"));
  }

  const pathParts = splitPathForSort(cursor.path);
  const canShowGroup = pathParts.length >= minFreeLinkGroupParts;
  const childNodes = Array.from(cursor.children.values()).flatMap((child) =>
    compressFreeLinkTrieNode(child, canShowGroup ? depth + 1 : depth),
  );
  const terminalNodes = freeLinkLeafNodes(cursor.terminalLinks, canShowGroup ? depth + 1 : depth);

  if (!canShowGroup) {
    const nodes = [...terminalNodes, ...childNodes];
    sortTreeNodes(nodes);
    return nodes;
  }

  const children = [...terminalNodes, ...childNodes];

  sortTreeNodes(children);
  return [
    {
      id: `source:free-dir:${cursor.path}`,
      name: parts.join("\\"),
      path: cursor.path,
      depth,
      links: cursor.links,
      statusCounts: cursor.statusCounts,
      children,
    },
  ];
}

function freeLinkLeafNodes(links: LinkRecord[], depth: number, sharedName?: string): LinkTreeNode[] {
  return links.map((link) => ({
    id: `source:free-link:${link.id}:${link.source}`,
    name: sharedName && links.length === 1 ? sharedName : freeLinkNodeName(link),
    path: link.source,
    depth,
    links: [link],
    statusCounts: { [link.status]: 1 },
    children: [],
    link,
  }));
}

export function isFreeLinkGroup(groupId: string) {
  return groupId === "free-links-source-outside-data-repo" || groupId === "external-source-links";
}

function freeLinkNodeName(link: LinkRecord) {
  return link.label || lastPathPart(link.source) || link.id;
}

function lastPathPart(path: string) {
  const parts = splitPathParts(path);
  return parts[parts.length - 1];
}

function attachMappingRoots(
  nodes: LinkTreeNode[],
  groupId: string,
  mappingRoots: LinkSettings["mappingRoots"],
) {
  const roots = mappingRoots.filter((root) => (root.dataRepoId ?? "primary") === groupId);
  const visit = (node: LinkTreeNode) => {
    const match = roots.find((root) => pathsSameForUi(root.resolvedSource, node.path));
    if (match) node.mappingRoot = match;
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
}

function pathsSameForUi(a: string, b: string) {
  return normalizePathForSort(a) === normalizePathForSort(b);
}

function pathForTreeMode(link: LinkRecord, mode: LinkTreeMode) {
  return mode === "source" ? link.source : link.target;
}

function sortTreeNodes(nodes: LinkTreeNode[]) {
  nodes.sort((a, b) => {
    if (!!a.link !== !!b.link) return a.link ? 1 : -1;
    return comparePathsByHierarchy(a.path, b.path) || a.name.localeCompare(b.name);
  });
  nodes.forEach((node) => sortTreeNodes(node.children));
}

function relativePathParts(path: string, basePath: string) {
  const parts = splitPathParts(path);
  const partsForCompare = splitPathForSort(path);
  const baseParts = splitPathForSort(basePath);
  let offset = 0;
  while (offset < baseParts.length && partsForCompare[offset] === baseParts[offset]) offset += 1;
  return parts.slice(offset);
}

function joinSortPath(parent: string, child: string) {
  return parent ? `${parent}\\${child}` : child;
}

function compareGroupsByHierarchy(a: LinkTreeGroup, b: LinkTreeGroup) {
  return (
    comparePathsByHierarchy(a.sortPath, b.sortPath) ||
    a.label.localeCompare(b.label) ||
    a.id.localeCompare(b.id)
  );
}

function compareLinksByHierarchy(a: LinkRecord, b: LinkRecord, mode: LinkTreeMode) {
  return (
    comparePathsByHierarchy(pathForTreeMode(a, mode), pathForTreeMode(b, mode)) ||
    comparePathsByHierarchy(a.target, b.target) ||
    a.label.localeCompare(b.label) ||
    a.id.localeCompare(b.id)
  );
}

export function comparePathsByHierarchy(a: string, b: string) {
  const aParts = splitPathForSort(a);
  const bParts = splitPathForSort(b);
  const sharedLength = Math.min(aParts.length, bParts.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const partCompare = aParts[index].localeCompare(bParts[index], undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (partCompare !== 0) return partCompare;
  }

  if (aParts.length !== bParts.length) return aParts.length - bParts.length;
  return normalizePathForSort(a).localeCompare(normalizePathForSort(b));
}

function commonParentPath(paths: string[]) {
  if (paths.length === 0) return "";
  const splitPaths = paths.map((path) => splitPathForSort(parentPath(path)));
  const first = splitPaths[0] ?? [];
  const common: string[] = [];

  for (let index = 0; index < first.length; index += 1) {
    const value = first[index];
    if (splitPaths.every((parts) => parts[index] === value)) {
      common.push(value);
    } else {
      break;
    }
  }

  return common.join("\\");
}

function parentPath(path: string) {
  const normalized = normalizePathForSort(path);
  const parts = splitPathForSort(normalized);
  if (parts.length <= 1) return normalized;
  return parts.slice(0, -1).join("\\");
}

function splitPathForSort(path: string) {
  const normalized = normalizePathForSort(path);
  return normalized.split("\\").filter(Boolean);
}

function splitPathParts(path: string) {
  return path.replace(/\//g, "\\").replace(/\\+$/g, "").split("\\").filter(Boolean);
}

function normalizePathForSort(path: string) {
  return path.replace(/\//g, "\\").replace(/\\+$/g, "").toLowerCase();
}

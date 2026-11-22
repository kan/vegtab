import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  licenseText,
  mergeCopies,
  OWN_PACKAGES,
  ownLicense,
  packageDirOf,
  repositoryUrl,
  SERVER_PACKAGES,
} from "../../scripts/licenses-plugin";

/** A relative import's file, as the bundler finds it. */
function resolveSource(from: string, specifier: string): string {
  const target = path.resolve(path.dirname(from), specifier);
  const file = [
    target,
    target.replace(/\.js$/, ".ts"),
    `${target}.ts`,
    path.join(target, "index.ts"),
  ].find((candidate) =>
    fs.statSync(candidate, { throwIfNoEntry: false })?.isFile(),
  );
  if (!file) throw new Error(`${from}: cannot resolve ${specifier}`);
  return file;
}

/**
 * The packages an entry's code imports, following its own imports. Type-only
 * imports are left out: they never reach the bundle.
 */
function packagesImportedFrom(entry: string): Set<string> {
  const packages = new Set<string>();
  const seen = new Set<string>();
  const queue = [path.resolve(import.meta.dirname, entry)];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const [
      ,
      typeOnly,
      staticSpecifier,
      dynamicSpecifier,
    ] of source.matchAll(
      /\b(?:import|export)\s+(type\s+)?(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    )) {
      const specifier = staticSpecifier ?? dynamicSpecifier;
      if (typeOnly) continue;
      if (specifier.startsWith(".")) queue.push(resolveSource(file, specifier));
      else if (!specifier.startsWith("cloudflare:")) {
        const parts = specifier.split("/");
        packages.add(
          specifier.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0],
        );
      }
    }
  }
  return packages;
}

describe("licenses plugin", () => {
  it("lists every package the Worker imports", () => {
    const imported = packagesImportedFrom("../../src/worker/main.ts");
    // The Worker does import our own packages (kan-game), which are not listed
    for (const own of OWN_PACKAGES) expect(imported).toContain(own);
    expect(
      [...imported].filter((name) => !OWN_PACKAGES.includes(name)).sort(),
    ).toEqual([...SERVER_PACKAGES].sort());
  });

  // Our own packages are left out with what they depend on: a dependency they
  // add would reach the Worker's bundle without a line on the licenses page.
  it("keeps our own packages free of dependencies", () => {
    for (const own of OWN_PACKAGES) {
      const pkg = JSON.parse(
        fs.readFileSync(
          path.join(import.meta.dirname, "../../node_modules", own, "package.json"),
          "utf8",
        ),
      ) as { dependencies?: Record<string, string> };
      expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    }
  });

  // The service worker's own script (public/push-sw.js) is not bundled: it
  // must stay free of packages, which the plugin would not see.
  it("keeps packages out of the push handler of the service worker", () => {
    const source = fs.readFileSync(
      path.join(import.meta.dirname, "../../public/push-sw.js"),
      "utf8",
    );
    expect(source).not.toMatch(/\bimport\b|importScripts\s*\(/);
  });

  it("finds the package a bundled module comes from", () => {
    expect(
      packageDirOf("/repo/node_modules/uqr/dist/index.mjs?commonjs-proxy"),
    ).toBe("/repo/node_modules/uqr");
    expect(
      packageDirOf(
        "\0/repo/node_modules/@vue/runtime-dom/dist/runtime-dom.esm-bundler.js",
      ),
    ).toBe("/repo/node_modules/@vue/runtime-dom");
    // A package nested inside another one is its own package.
    expect(
      packageDirOf("C:\\repo\\node_modules\\a\\node_modules\\b\\i.js"),
    ).toBe("C:/repo/node_modules/a/node_modules/b");
    expect(packageDirOf("/repo/src/App.vue")).toBeNull();
    // Our own packages are our own code, not open source to list.
    expect(
      packageDirOf("/repo/node_modules/kan-game/src/name-rules.ts"),
    ).toBeNull();
  });

  it("turns the repository field into a page to link to", () => {
    expect(
      repositoryUrl({
        repository: { url: "git+https://github.com/vuejs/core.git" },
      }),
    ).toBe("https://github.com/vuejs/core");
    expect(repositoryUrl({ repository: "unjs/uqr" })).toBe(
      "https://github.com/unjs/uqr",
    );
    expect(repositoryUrl({ repository: "github:block65/web-push" })).toBe(
      "https://github.com/block65/web-push",
    );
    expect(repositoryUrl({ homepage: "https://example.test/" })).toBe(
      "https://example.test/",
    );
    expect(repositoryUrl({})).toBeNull();
    expect(
      repositoryUrl({ repository: "git+ssh://git@github.com/o/r.git" }),
    ).toBe("https://github.com/o/r");
    expect(repositoryUrl({ repository: "git@gitlab.com:o/r.git" })).toBe(
      "https://gitlab.com/o/r",
    );
    expect(repositoryUrl({ repository: "gitlab:o/r" })).toBe(
      "https://gitlab.com/o/r",
    );
    // A homepage that is not a web page is not linked.
    expect(repositoryUrl({ homepage: "javascript:alert(1)" })).toBeNull();
    expect(repositoryUrl({ homepage: "./docs" })).toBeNull();
  });

  it("keeps a licence's own text, not its bundled dependencies'", () => {
    const vite = [
      "# Vite core license",
      "MIT License",
      "",
      "# Licenses of bundled dependencies",
      "## @jridgewell/trace-mapping",
    ].join("\n");
    expect(ownLicense("vite", vite)).toBe("# Vite core license\nMIT License");
    expect(ownLicense("vue", "MIT License\n\nCopyright (c) Vue\n")).toBe(
      "MIT License\n\nCopyright (c) Vue",
    );
    // Another package may inline its dependencies into the browser code:
    // their notices stay.
    expect(ownLicense("some-lib", vite)).toBe(vite);
  });

  // Should Vite rename the heading, the whole section would come back.
  it("finds the bundled dependencies in the installed Vite's licence", () => {
    const installed = fs.readFileSync(
      path.join(import.meta.dirname, "../../node_modules/vite/LICENSE.md"),
      "utf8",
    );
    const own = ownLicense("vite", installed);
    expect(own).toMatch(/^# Vite core license/);
    expect(own).not.toMatch(/bundled dependencies/i);
    expect(own.length).toBeLessThan(installed.length / 10);
  });

  it("reads every licence file of a package, in name order", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "licenses-"));
    try {
      fs.writeFileSync(path.join(dir, "LICENSE-MIT"), "MIT text\n");
      fs.writeFileSync(path.join(dir, "LICENSE-APACHE"), "Apache text\n");
      fs.writeFileSync(path.join(dir, "README.md"), "Not a licence");
      // A directory with a licence's name is not read.
      fs.mkdirSync(path.join(dir, "LICENSE.d"));
      // The same text in another format shows once; an empty file not at all.
      fs.writeFileSync(path.join(dir, "LICENSE.txt"), "MIT text");
      fs.writeFileSync(path.join(dir, "COPYING"), "\n");
      expect(licenseText(dir, "dual")).toBe("Apache text\n\n----\n\nMIT text");
      // A symlinked licence is read through the link.
      fs.rmSync(path.join(dir, "LICENSE-APACHE"));
      fs.symlinkSync(
        path.join(dir, "LICENSE-MIT"),
        path.join(dir, "LICENSE-APACHE"),
      );
      expect(licenseText(dir, "linked")).toBe("MIT text");
      for (const file of ["LICENSE-MIT", "LICENSE-APACHE", "LICENSE.txt"])
        fs.rmSync(path.join(dir, file));
      expect(licenseText(dir, "none")).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists the same version left in two places once, with both uses", () => {
    const copy = (version: string) => ({
      name: "a",
      version,
      license: "MIT",
      url: null,
      text: null,
    });
    expect(
      mergeCopies([
        [copy("1.0.0"), new Set(["sw"] as const)],
        [copy("1.0.0"), new Set(["app"] as const)],
        [copy("2.0.0"), new Set(["server"] as const)],
      ]),
    ).toEqual([
      { ...copy("1.0.0"), usedIn: ["app", "sw"] },
      { ...copy("2.0.0"), usedIn: ["server"] },
    ]);
  });
});

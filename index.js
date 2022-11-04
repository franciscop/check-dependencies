#!/usr/bin/env node
import { exists, list, read, swear } from "files";
import meow from "meow";
import chalk from "chalk";
import { fileURLToPath } from "node:url";

import licenses from "./src/licenses.js";
import checkNodeVersion from "./src/checkNodeVersion.js";
import findDependencies from "./src/findDependencies.js";

const cli = meow(
  `
  A simple tool to check all the licenses in your dependencies:
    $ npx check-licenses
    $ npx check-licenses --list
    $ npx --yes check-licenses   # CI, automated

  Options
    --list, -l  Show a list of all of the dependencies instead of the summary

  Examples
    $ npx check-licenses
    MIT ————————————————— 1328
    ISC ————————————————— 113
    CC0-1.0 ————————————— 36
    BSD-3-Clause ———————— 36
    Apache-2.0 —————————— 5
    BSD-2-Clause ———————— 3
    Zlib ———————————————— 1
    CC-BY-3.0 ——————————— 1
    GPL-2.0 ————————————— 1

    $ npx check-licenses --list
    ...
    test-exclude@5.2.3 ———————————— ISC
    text-table@0.2.0 —————————————— MIT
    textarea-caret@3.0.2 —————————— MIT
    throat@4.1.0 —————————————————— MIT
    through@2.3.8 ————————————————— Apache-2.0 + MIT
    through2@2.0.5 ———————————————— MIT
    thunky@1.1.0 —————————————————— MIT
    timers-browserify@2.0.11 —————— MIT
    ...

    # Grab all of the GPL licenses
    $ npx check-licenses --list | grep GPL
`,
  {
    importMeta: import.meta,
    flags: { list: { type: "boolean", alias: "l", default: false } },
  }
);

const unique = (value, index, self) => self.indexOf(value) === index;

const pkgLicense = (pkg) => {
  let license = pkg.licenses || pkg.license || [];

  // { type: 'MIT' } => 'MIT'
  if (license.type) {
    license = license.type;
  }

  // Convert any kind of license to an array of licenses
  if (Array.isArray(license)) {
    // [{ type: 'MIT' }, 'ISC'] => ['MIT', 'ISC']
    license = license.filter(Boolean).map((lic) => lic.type || lic);

    // ['MIT', 'ISC'] => 'MIT OR ISC'
    license = license.join(" OR ");
  }

  // '(MIT OR ISC)' => 'MIT OR ISC'
  license = license.replace(/\(/g, "").replace(/\)/g, "");

  return license
    .split(/\W+(?:OR|AND)\W+/gi) // https://stackoverflow.com/q/21419530/938236
    .filter(Boolean)
    .filter(unique);
};

const fileLicense = async (pkg) => {
  const licFile = await list(pkg.path)
    // .map((file) => file.replace(process.cwd() + "/", ""))
    .find((file) => /licen(s|c)e/i.test(file.split("/").pop()));
  if (!licFile) return [];
  const text = await read(licFile);

  const found = licenses.find((lic) => lic.regex.test(text));
  if (found) return [found.identifier];
  return [];
};

(async () => {
  checkNodeVersion("12.17.0");

  // Find all the required dependencies
  const packages = await findDependencies(process.cwd());

  if (!packages.length) {
    return console.log("No production dependencies! 🥳");
  }

  const pkgs = await swear(packages).map(async (pkg) => {
    if (pkg.missing) {
      return { ...pkg, all: ["missing"] };
    }

    const pkgSrc = pkg.path + "/package.json";

    // Can find a package.json
    const info = await read(pkgSrc).then((data) => JSON.parse(data));

    // We have a better name to display if we find the package.json:
    // console.log(pkg, info);
    pkg.name = info.name;
    pkg.version = info.version;
    pkg.package = pkgLicense(info);

    pkg.file = await fileLicense(pkg);
    pkg.all = [...pkg.package, ...pkg.file].filter(unique).sort();
    return pkg;
  });

  if (cli.flags.list) {
    pkgs
      .map((pkg) => {
        const title = pkg.id.length >= 39 ? pkg.id.slice(0, 38) + "…" : pkg.id;
        const dots = chalk.gray(title.padEnd(40, "—").replace(title, ""));
        let licenses = pkg.all.join(chalk.bold.magenta(" + "));
        if (licenses === "missing") {
          licenses = chalk.gray("missing");
        }
        return `${title} ${dots} ${licenses}`;
      })
      .map((line) => console.log(line));
  } else {
    Object.entries(
      pkgs
        .map((pkg) => pkg.all)
        .flat()
        .reduce((all, name) => ({ ...all, [name]: (all[name] || 0) + 1 }), {})
    )
      .sort((p1, p2) => p2[1] - p1[1])
      .forEach(([key, value]) => {
        let title = key.length >= 19 ? key.slice(0, 18) + "…" : key;
        const dots = chalk.gray(title.padEnd(20, "—").replace(title, ""));
        const licenses = value;
        if (title === "missing") {
          title = chalk.dim("missing");
        }
        console.log(`${title} ${dots} ${licenses}`);
      });
  }

  const missingOptional = pkgs.filter((pkg) => pkg.missing).length;
  if (missingOptional) {
    console.warn(
      chalk`\n{yellow Warning}: missing package.json from {bold.italic ${missingOptional} optional} packages`
    );
  }
})().catch((error) => {
  console.log(chalk`{red.bold Error:} ${error.message.trim()}`);
});

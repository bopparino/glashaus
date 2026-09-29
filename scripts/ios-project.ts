import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "../ios");
const id = (name: string) =>
  createHash("sha256").update(name).digest("hex").slice(0, 24).toUpperCase();
const objects: string[] = [];
const add = (name: string, value: string) => {
  objects.push(`${id(name)} = { ${value} };`);
  return id(name);
};
const list = (names: string[]) => `(${names.map(id).join(",")},)`;
add("signing", 'isa = PBXFileReference; lastKnownFileType = text.xcconfig; path = Signing.xcconfig; sourceTree = "<group>";');
const appFiles = readdirSync(path.join(root, "Glashaus")).filter((file) => file.endsWith(".swift")).sort();
for (const file of [...appFiles, "GlashausUITests.swift"]) {
  add(
    file,
    `isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${file}; sourceTree = "<group>";`,
  );
  add(file + "build", `isa = PBXBuildFile; fileRef = ${id(file)};`);
}
add(
  "assets",
  'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = Assets.xcassets; sourceTree = "<group>";',
);
add("assetsbuild", `isa = PBXBuildFile; fileRef = ${id("assets")};`);
for (const name of ["Glashaus", "GlashausUITests"]) {
  const app = name === "Glashaus";
  add(
    name + "product",
    `isa = PBXFileReference; explicitFileType = ${app ? "wrapper.application" : '"wrapper.cfbundle"'}; includeInIndex = 0; path = ${name}.${app ? "app" : "xctest"}; sourceTree = BUILT_PRODUCTS_DIR;`,
  );
  add(
    name + "sources",
    `isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ${list((app ? appFiles : ["GlashausUITests.swift"]).map((n) => n + "build"))}; runOnlyForDeploymentPostprocessing = 0;`,
  );
  add(
    name + "frameworks",
    "isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;",
  );
  add(
    name + "resources",
    `isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ${app ? list(["assetsbuild"]) : "()"}; runOnlyForDeploymentPostprocessing = 0;`,
  );
  for (const mode of ["Debug", "Release"])
    add(
      name + mode,
      `isa = XCBuildConfiguration; name = ${mode}; baseConfigurationReference = ${id("signing")}; buildSettings = { CODE_SIGN_STYLE = Automatic; PRODUCT_BUNDLE_IDENTIFIER = net.glashaus.${app ? "companion" : "companion.uitests"}; PRODUCT_NAME = "$(TARGET_NAME)"; SWIFT_VERSION = 5.0; TARGETED_DEVICE_FAMILY = 1; IPHONEOS_DEPLOYMENT_TARGET = 26.0; SDKROOT = iphoneos; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; SUPPORTS_MACCATALYST = NO; ${app ? "INFOPLIST_FILE = Glashaus/Info.plist; ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;" : "GENERATE_INFOPLIST_FILE = YES; TEST_TARGET_NAME = Glashaus;"} SWIFT_EMIT_LOC_STRINGS = YES; ${mode === "Debug" ? 'SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG; SWIFT_OPTIMIZATION_LEVEL = "-Onone";' : "SWIFT_COMPILATION_MODE = wholemodule;"} };`,
    );
  add(
    name + "configs",
    `isa = XCConfigurationList; buildConfigurations = ${list([name + "Debug", name + "Release"])}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`,
  );
  add(
    name + "target",
    `isa = PBXNativeTarget; buildConfigurationList = ${id(name + "configs")}; buildPhases = ${list([name + "sources", name + "frameworks", name + "resources"])}; buildRules = (); dependencies = ${app ? "()" : list(["dependency"])}; name = ${name}; productName = ${name}; productReference = ${id(name + "product")}; productType = "com.apple.product-type.${app ? "application" : "bundle.ui-testing"}";`,
  );
}
add(
  "dependencyProxy",
  `isa = PBXContainerItemProxy; containerPortal = ${id("project")}; proxyType = 1; remoteGlobalIDString = ${id("Glashaustarget")}; remoteInfo = Glashaus;`,
);
add(
  "dependency",
  `isa = PBXTargetDependency; target = ${id("Glashaustarget")}; targetProxy = ${id("dependencyProxy")};`,
);
add(
  "appGroup",
  `isa = PBXGroup; children = ${list([...appFiles, "assets"])}; path = Glashaus; sourceTree = "<group>";`,
);
add(
  "testGroup",
  `isa = PBXGroup; children = ${list(["GlashausUITests.swift"])}; path = GlashausUITests; sourceTree = "<group>";`,
);
add(
  "products",
  `isa = PBXGroup; children = ${list(["Glashausproduct", "GlashausUITestsproduct"])}; name = Products; sourceTree = "<group>";`,
);
add(
  "mainGroup",
  `isa = PBXGroup; children = ${list(["signing", "appGroup", "testGroup", "products"])}; sourceTree = "<group>";`,
);
for (const mode of ["Debug", "Release"])
  add(
    "project" + mode,
    `isa = XCBuildConfiguration; name = ${mode}; buildSettings = { CLANG_ENABLE_MODULES = YES; CLANG_ENABLE_OBJC_ARC = YES; DEBUG_INFORMATION_FORMAT = ${mode === "Debug" ? "dwarf" : '"dwarf-with-dsym"'}; ENABLE_TESTABILITY = ${mode === "Debug" ? "YES" : "NO"}; };`,
  );
add(
  "projectconfigs",
  `isa = XCConfigurationList; buildConfigurations = ${list(["projectDebug", "projectRelease"])}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`,
);
add(
  "project",
  `isa = PBXProject; attributes = { LastUpgradeCheck = 2700; BuildIndependentTargetsInParallel = YES; }; buildConfigurationList = ${id("projectconfigs")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en,Base,); mainGroup = ${id("mainGroup")}; productRefGroup = ${id("products")}; projectDirPath = ""; projectRoot = ""; targets = ${list(["Glashaustarget", "GlashausUITeststarget"])};`,
);
mkdirSync(path.join(root, "Glashaus.xcodeproj/xcshareddata/xcschemes"), {
  recursive: true,
});
writeFileSync(
  path.join(root, "Glashaus.xcodeproj/project.pbxproj"),
  `// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n${objects.join("\n")}\n}; rootObject = ${id("project")}; }\n`,
);
const ref = (name: string) =>
  `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id(name + "target")}" BuildableName="${name}.${name === "Glashaus" ? "app" : "xctest"}" BlueprintName="${name}" ReferencedContainer="container:Glashaus.xcodeproj"/>`;
writeFileSync(
  path.join(
    root,
    "Glashaus.xcodeproj/xcshareddata/xcschemes/Glashaus.xcscheme",
  ),
  `<?xml version="1.0" encoding="UTF-8"?><Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${ref("Glashaus")}</BuildActionEntry></BuildActionEntries></BuildAction><TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${ref("GlashausUITests")}</TestableReference></Testables></TestAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${ref("Glashaus")}</BuildableProductRunnable></LaunchAction><ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${ref("Glashaus")}</BuildableProductRunnable></ProfileAction><AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/></Scheme>`,
);
console.log("Updated ios/Glashaus.xcodeproj");

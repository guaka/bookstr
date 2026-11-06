export interface BundledDirectory {
  from: string;
  to: string;
  filter: string[];
}

export interface DesktopPackageManifest {
  packageManager: string;
  engines: { node: string };
  scripts: Record<string, string>;
  optionalDependencies: Record<string, string>;
  build: { files: (string | BundledDirectory)[] };
}

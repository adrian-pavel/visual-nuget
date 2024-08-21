# Visual Nuget

### v0.3.1

- fix a bug related to multiple ItemGroup tags in the same csproj file not being read properly

### v0.3.0

- no functional changes
- updated Angular and dependencies

### v0.2.1

- added verified icon to verified packages
- added panel resizing for package list and details
- added settings button next to sources
- automatically update sources once settings are changed
- display correct formatting for package description in details panel

### v0.2.0

- ### **nuget.org is in the settings now so that it can be replaced if needed (possible breaking change, need to reset the settings and re-add private sources)**
- filter out unlisted packages
- display package version vulnerabilities
- Update tab select multiple and update to latest version in one click

### v0.1.3

- minor bug fixes
- code quality improvements

### v0.1.2

- fixed bug where project files in sub-directories were not processed correctly (Installed/Updates did not work)
- added tooltip with full project file path on hover over project name in nav-bar

### v0.1.1

- fixed bug that crashed the extension when used on a project with no installed packages
- fixed issue with dotnet add quoting caused by VS Code bug. (bug is fixed in latest VS Code version)

### v0.1.0

- load metadata for each version
- display version dependencies and published date
- fixed metadata loading for packages with hundreds of versions
- added loading animation to the package list view

### v0.0.5

- semver sorting
- fixed installed/updates tabs for private repos, hope it works for all now
- added status icons on search results showing installed/outdated status

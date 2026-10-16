# Visual Nuget

A visual NuGet package manager. Search for, install and uninstall NuGet packages. (.Net Framework not supported)

**Unfortunately I just don't have enough time to actively develop visual-nuget anymore. Maybe in the future, but for now please do not expect updates from my side and take it as is.**

### **Need to have dotnet installed. The extension forwards the commands to the dotnet cli.**

### Known issues and missing features

1. Github NuGet registry not supported properly yet. Others probably as well.
2. Lazy loading more results not implemented yet.

## Quick peek

![Quick peek animation](images/quick_peek.gif)

## How to use

Right click on any .csproj, .fsproj or .vbproj file in your workspace and click on the "Visual NuGet: Manage Packages" menu entry.

This will open a panel with the UI to manage your packages. It is very similar to the NuGet Package Manager in Visual Studio.

### Solution-level management and Central Package Management

Right-click a `.sln` or `.slnx` file and choose **Visual NuGet: Manage Solution Packages**, or run the solution command from the Command Palette. The solution view aggregates package state across supported C#, F# and Visual Basic projects. Select a package to see its per-project installed version and whether it is a direct or transitive dependency; use the checkboxes in that package's details to choose projects for its install, update, or uninstall operation.

Install and update operations run for each checked project and report individual successes, failures, and skipped projects. Uninstall affects checked projects where the package is directly referenced. CPM projects use evaluated MSBuild package data and the .NET package commands. A central version can also affect other projects using the same `PackageVersion` entry, even if those projects are not checked; use `VersionOverride` or framework-specific conditions when genuinely different versions are required.

The **Updates** tab shows a count of packages with updates and excludes packages that are only transitive dependencies. Select multiple updates and choose **Update** to apply them as a batch; package edits finish before one restore runs. **Build after restore** is optional. If restore or build fails after files changed, Visual NuGet offers a guarded rollback and will not overwrite package files that have since changed.

In solution mode, the **Consolidate** tab appears only when a package has different direct-reference versions in at least two projects. Transitive-only version differences are excluded. Select a package to compare project versions, choose which projects to change, and select the target package version.

When updating a CPM package in a solution, known project-level overrides and framework-specific versions are preserved by default. For explicitly checked projects, enable **Also update package overrides and framework-specific versions** to include those entries. Individual install and uninstall operations do not roll back successful changes in other projects. Transitive package information comes from the project's restore graph; restore the project if that information is unavailable.

Solution support is an initial implementation: unsupported project types are skipped and reported, and projects that MSBuild cannot evaluate are shown as load failures.

## Vulnerability and deprecation information

When a package source provides vulnerability or deprecation metadata, Visual NuGet displays informational warnings in package results and details for the latest version. Warnings do not hide packages, change the selected version, or automatically update dependencies. Historical version-specific warning data depends on the source; an absent warning should not be treated as proof that a version is safe.

## Adding new package sources

By default, Visual NuGet only uses nuget.org as a package source but you can add your own, including private ones.

For this you have to go into the setting and add a new item to the list.

Sources are defined by a JSON string with of the following format:  
"{\"name\": \"nuget.org\",\"url\": \"https://api.nuget.org/v3/index.json\", "authorizationHeader": undefined}"

The **name** property is just the friendly name that will be displayed in the UI.  
The **url** property needs to point to the index.json file of the API.  
The **authorizationHeader** is only needed if the source is private and requires authentication/authorization.

To compose the authorizatonHeader check the documentation of the API you want to use as a source.  
It usually is either a "Basic mybase64EncodedUsernameAndPassword" or "Bearer myPersonalPrivateAccessToken".

**Example**  
_Azure DevOps_  
Create a PAT by following the guide [here](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops&tabs=Windows#create-a-pat). Make sure to give it **Packaging Read access**.  
With the created PAT base64 encode a string of the following format: VssSessionToken:MyNewlyCreatedPAT  
Compose the **authorizationHeader** like so: "Basic MyBase64EncodedString". It should look something like this: "Basic VnNzU2Vzc2lvblRva2VuOk15TmV3bHlDcmVhdGVkUEFU".  
Use this string when defining the source in the Settings.

## Release notes

[Check the changelog here](CHANGELOG.md)

## Any questions or issues?

Don't hesitate to ask on [https://github.com/adrian-pavel/visual-nuget/issues](https://github.com/adrian-pavel/visual-nuget/issues)

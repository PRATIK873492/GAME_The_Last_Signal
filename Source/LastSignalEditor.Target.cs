using UnrealBuildTool;

public class LastSignalEditorTarget : TargetRules
{
	public LastSignalEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.Add("LastSignal");
	}
}

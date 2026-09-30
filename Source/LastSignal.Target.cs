using UnrealBuildTool;

public class LastSignalTarget : TargetRules
{
	public LastSignalTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_4;
		ExtraModuleNames.Add("LastSignal");
	}
}

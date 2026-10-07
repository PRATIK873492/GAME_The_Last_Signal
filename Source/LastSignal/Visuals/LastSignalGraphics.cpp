#include "Visuals/LastSignalGraphics.h"

#include "GameFramework/GameUserSettings.h"
#include "HAL/IConsoleManager.h"
#include "RHI.h"

static void SetCVar(const TCHAR* Name, float Value)
{
	if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(Name))
		V->Set(Value, ECVF_SetByGameSetting);
}

void ULastSignalGraphics::ApplyGraphicsPreset(ELSGraphicsPreset Preset)
{
	UGameUserSettings* S = GEngine ? GEngine->GetGameUserSettings() : nullptr;
	if (!S) return;

	// engine scalability: 0 Low, 1 Medium, 2 High, 3 Epic
	const int32 Level = static_cast<int32>(Preset);
	S->SetOverallScalabilityLevel(Level);

	struct FRow { float ScreenPct, LumenGather, ShadowBias, MotionBlur, VolFog, FoliageScale; };
	static const FRow Rows[] = {
		//  screen%  lumen  vsm bias  mblur  volfog  foliage
		{ 60.f,   0.5f,  1.5f,    0.0f,  0.f,   0.4f },   // Low   (GTX 1660)
		{ 70.f,   0.75f, 1.0f,    0.3f,  1.f,   0.7f },   // Medium
		{ 75.f,   1.0f,  0.0f,    0.4f,  1.f,   1.0f },   // High  (RTX 3070-class)
		{ 100.f,  1.0f,  0.0f,    0.5f,  1.f,   1.0f },   // Ultra
	};
	const FRow& R = Rows[FMath::Clamp(Level, 0, 3)];
	SetCVar(TEXT("r.ScreenPercentage"), R.ScreenPct);                         // TSR upscales back to native
	SetCVar(TEXT("r.Lumen.ScreenProbeGather.Quality"), R.LumenGather);
	SetCVar(TEXT("r.Shadow.Virtual.ResolutionLodBiasDirectional"), R.ShadowBias);
	SetCVar(TEXT("r.MotionBlur.Amount"), R.MotionBlur);
	SetCVar(TEXT("r.VolumetricFog"), R.VolFog);
	SetCVar(TEXT("foliage.DensityScale"), R.FoliageScale);
	SetCVar(TEXT("grass.DensityScale"), R.FoliageScale);

	S->ApplySettings(false);
	S->SaveSettings();
}

ELSGraphicsPreset ULastSignalGraphics::ApplyRecommendedPreset()
{
	FTextureMemoryStats Stats;
	RHIGetTextureMemoryStats(Stats);
	const int64 VramMB = Stats.DedicatedVideoMemory / (1024 * 1024);
	const bool bStrong = GRHISupportsRayTracing && VramMB >= 8000;
	const ELSGraphicsPreset P = bStrong ? ELSGraphicsPreset::High : ELSGraphicsPreset::Low;
	ApplyGraphicsPreset(P);
	return P;
}

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "LastSignalGraphics.generated.h"

/** The four presets of the in-game graphics menu (same names as the web build). */
UENUM(BlueprintType)
enum class ELSGraphicsPreset : uint8
{
	Low,     // GTX 1660 target: 1080p / 30 FPS
	Medium,
	High,    // RTX 3070-class target: 1440p / 60 FPS
	Ultra
};

/**
 * Applies a preset: engine scalability groups + the Last Signal specific console variables
 * (screen percentage, Lumen quality, shadow bias, motion blur, volumetric fog).
 * Call from the pause-menu widget; settings are saved to GameUserSettings.ini.
 */
UCLASS()
class LASTSIGNAL_API ULastSignalGraphics : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	UFUNCTION(BlueprintCallable, Category = "Last Signal|Graphics")
	static void ApplyGraphicsPreset(ELSGraphicsPreset Preset);

	/** Low on GPUs without hardware ray tracing and less than 8 GB VRAM, otherwise High. */
	UFUNCTION(BlueprintCallable, Category = "Last Signal|Graphics")
	static ELSGraphicsPreset ApplyRecommendedPreset();
};

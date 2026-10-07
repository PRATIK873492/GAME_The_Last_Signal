#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DayNightManager.generated.h"

class ADirectionalLight;
class ASkyLight;
class AExponentialHeightFog;
class UMaterialParameterCollection;

/**
 * Dynamic day-night cycle, same curve as the web build:
 *   sun rises at 06:00, sets at 18:00; golden hour near the horizon; moonlight at night.
 *   Street lamps (any light component on an actor tagged "StreetLamp") switch on after dusk,
 *   ~15% of them flicker like faulty blackout-era lamps.
 * Assign the level's sun, moon (a second directional light), sky light and height fog.
 */
UCLASS(Blueprintable)
class LASTSIGNAL_API ADayNightManager : public AActor
{
	GENERATED_BODY()

public:
	ADayNightManager();

	/** Hours, 0..24. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Time", meta = (ClampMin = "0", ClampMax = "24"))
	float TimeOfDay = 7.f;

	/** Real seconds per in-game hour (0 = frozen clock, e.g. for a cutscene). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Time", meta = (ClampMin = "0"))
	float SecondsPerHour = 120.f;

	UPROPERTY(EditAnywhere, Category = "Lights") TObjectPtr<ADirectionalLight> Sun = nullptr;
	UPROPERTY(EditAnywhere, Category = "Lights") TObjectPtr<ADirectionalLight> Moon = nullptr;
	UPROPERTY(EditAnywhere, Category = "Lights") TObjectPtr<ASkyLight> SkyLight = nullptr;
	UPROPERTY(EditAnywhere, Category = "Lights") TObjectPtr<AExponentialHeightFog> HeightFog = nullptr;

	/** Optional: writes Daylight (0..1) and TimeOfDay into this collection for materials (lit windows, emissives). */
	UPROPERTY(EditAnywhere, Category = "Lights") TObjectPtr<UMaterialParameterCollection> TimeMPC = nullptr;

	UPROPERTY(EditAnywhere, Category = "Lights") float SunLux = 10.f;      // physical-ish units with auto exposure on
	UPROPERTY(EditAnywhere, Category = "Lights") float MoonLux = 0.6f;     // bright moon: keeps the city readable at night (web build fix)
	UPROPERTY(EditAnywhere, Category = "Lights") float StreetLampIntensity = 8000.f;

	/** 0 at night, 1 at full day. */
	UFUNCTION(BlueprintPure, Category = "Time")
	float GetDaylight() const { return Daylight; }

	UFUNCTION(BlueprintCallable, Category = "Time")
	void SetTimeOfDay(float Hours) { TimeOfDay = FMath::Fmod(FMath::Max(0.f, Hours), 24.f); }

protected:
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

private:
	void CollectLamps();
	struct FLamp { TWeakObjectPtr<class ULightComponent> Light; bool bBroken = false; float Seed = 0.f; };
	TArray<FLamp> Lamps;
	float Daylight = 1.f;
	float Clock = 0.f;
};

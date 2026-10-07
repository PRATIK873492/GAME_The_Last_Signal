#include "Visuals/DayNightManager.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/LightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyLight.h"
#include "EngineUtils.h"
#include "Kismet/KismetMaterialLibrary.h"
#include "Materials/MaterialParameterCollection.h"

ADayNightManager::ADayNightManager()
{
	PrimaryActorTick.bCanEverTick = true;
}

void ADayNightManager::BeginPlay()
{
	Super::BeginPlay();
	CollectLamps();
}

void ADayNightManager::CollectLamps()
{
	Lamps.Reset();
	FRandomStream Rng(1741);
	for (TActorIterator<AActor> It(GetWorld()); It; ++It)
	{
		if (!It->ActorHasTag(TEXT("StreetLamp"))) continue;
		TArray<ULightComponent*> Comps;
		It->GetComponents<ULightComponent>(Comps);
		for (ULightComponent* L : Comps)
		{
			FLamp Lamp;
			Lamp.Light = L;
			Lamp.bBroken = Rng.FRand() < 0.15f;
			Lamp.Seed = Rng.FRand() * 100.f;
			Lamps.Add(Lamp);
		}
	}
}

static float SmoothStep01(float A, float B, float X)
{
	const float T = FMath::Clamp((X - A) / (B - A), 0.f, 1.f);
	return T * T * (3.f - 2.f * T);
}

void ADayNightManager::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	Clock += DeltaSeconds;
	if (SecondsPerHour > 0.f) TimeOfDay = FMath::Fmod(TimeOfDay + DeltaSeconds / SecondsPerHour, 24.f);

	// sun path: 0 rad at 06:00, PI at 18:00
	const float Theta = (TimeOfDay - 6.f) / 12.f * PI;
	const float Elev = FMath::Sin(Theta);
	Daylight = SmoothStep01(-0.08f, 0.25f, Elev);
	const float Golden = SmoothStep01(0.35f, 0.02f, Elev) * Daylight;

	if (Sun)
	{
		// pitch below the horizon at night so the sky atmosphere goes dark
		const float Pitch = -FMath::RadiansToDegrees(FMath::Asin(FMath::Clamp(Elev, -0.3f, 1.f)));
		const float Yaw = FMath::RadiansToDegrees(Theta) - 90.f;
		Sun->SetActorRotation(FRotator(Pitch, Yaw, 0.f));
		if (UDirectionalLightComponent* L = Cast<UDirectionalLightComponent>(Sun->GetLightComponent()))
		{
			L->SetIntensity(SunLux * Daylight);
			L->SetLightColor(FLinearColor(1.f, 0.93f - 0.3f * Golden, 0.85f - 0.45f * Golden));
		}
	}
	if (Moon)
	{
		Moon->SetActorRotation(FRotator(-35.f, 160.f, 0.f));
		if (ULightComponent* L = Moon->GetLightComponent())
		{
			L->SetIntensity(MoonLux * (1.f - Daylight));
			L->SetLightColor(FLinearColor(0.56f, 0.66f, 1.f));
		}
	}
	if (SkyLight && SkyLight->GetLightComponent())
	{
		// floor of ambient light at night (readability), full sky light by day
		SkyLight->GetLightComponent()->SetIntensity(0.35f + 0.65f * Daylight);
	}
	if (HeightFog && HeightFog->GetComponent())
	{
		UExponentialHeightFogComponent* F = HeightFog->GetComponent();
		const FLinearColor Day(0.56f, 0.6f, 0.63f), Sunset(0.78f, 0.55f, 0.4f), Night(0.07f, 0.1f, 0.16f);
		const FLinearColor C = FMath::Lerp(FMath::Lerp(Day, Sunset, Golden * 0.8f), Night, 1.f - Daylight);
		F->SetFogInscatteringColor(C);
	}

	// street lamps: on after dusk; broken ones flicker
	const float Night = 1.f - Daylight;
	for (const FLamp& Lamp : Lamps)
	{
		ULightComponent* L = Lamp.Light.Get();
		if (!L) continue;
		float K = Night > 0.4f ? 1.f : 0.f;
		if (Lamp.bBroken && K > 0.f)
			K = (FMath::Sin(Clock * 23.f + Lamp.Seed) > 0.2f && FMath::Sin(Clock * 1.7f + Lamp.Seed) > -0.4f) ? 1.f : 0.35f;
		L->SetIntensity(StreetLampIntensity * K);
	}

	if (TimeMPC)
	{
		UKismetMaterialLibrary::SetScalarParameterValue(this, TimeMPC, TEXT("Daylight"), Daylight);
		UKismetMaterialLibrary::SetScalarParameterValue(this, TimeMPC, TEXT("TimeOfDay"), TimeOfDay);
	}
}

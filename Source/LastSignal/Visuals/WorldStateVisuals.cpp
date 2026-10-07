#include "Visuals/WorldStateVisuals.h"

#include "Engine/GameInstance.h"
#include "Engine/PostProcessVolume.h"
#include "GameTheory/GameTheorySubsystem.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetMaterialLibrary.h"
#include "Materials/MaterialParameterCollection.h"
#include "Misc/App.h"

AWorldStateVisuals::AWorldStateVisuals()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bTickEvenWhenPaused = true;   // the decision blend must keep running in slow motion / pause
}

UGameTheorySubsystem* AWorldStateVisuals::GetGT() const
{
	const UGameInstance* GI = GetGameInstance();
	return GI ? GI->GetSubsystem<UGameTheorySubsystem>() : nullptr;
}

void AWorldStateVisuals::BeginPlay()
{
	Super::BeginPlay();
	if (UGameTheorySubsystem* GT = GetGT())
	{
		GT->OnRoundResolved.AddDynamic(this, &AWorldStateVisuals::HandleRound);
		if (GT->IsRiverDead()) Weather = ELSWeather::Dust;
	}
	if (DecisionVolume) DecisionVolume->BlendWeight = 0.f;
}

void AWorldStateVisuals::EndPlay(const EEndPlayReason::Type Reason)
{
	if (UGameTheorySubsystem* GT = GetGT())
		GT->OnRoundResolved.RemoveDynamic(this, &AWorldStateVisuals::HandleRound);
	if (DecisionTarget > 0.f) UGameplayStatics::SetGlobalTimeDilation(this, 1.f);
	Super::EndPlay(Reason);
}

void AWorldStateVisuals::HandleRound(EColony Colony, const FRoundRecord& Record)
{
	const UGameTheorySubsystem* GT = GetGT();
	OnColonyReaction(Colony, Record.PlayerAction == EGTAction::Cooperate, GT ? GT->GetHostilityLevel(Colony) : 0);
}

void AWorldStateVisuals::SetWeather(ELSWeather NewWeather)
{
	const UGameTheorySubsystem* GT = GetGT();
	// a dead river means dust storms instead of rain for the rest of the game
	if (GT && GT->IsRiverDead() && NewWeather == ELSWeather::Rain) NewWeather = ELSWeather::Dust;
	Weather = NewWeather;
}

void AWorldStateVisuals::BeginDecision()
{
	DecisionTarget = 1.f;
	UGameplayStatics::SetGlobalTimeDilation(this, DecisionTimeDilation);
}

void AWorldStateVisuals::EndDecision()
{
	DecisionTarget = 0.f;
	UGameplayStatics::SetGlobalTimeDilation(this, 1.f);
}

void AWorldStateVisuals::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	// real time, not dilated time, so blends stay smooth during the slow-motion decision screen
	const float RealDt = static_cast<float>(FApp::GetDeltaTime());

	DecisionWeight = FMath::FInterpTo(DecisionWeight, DecisionTarget, RealDt, 6.f);
	if (DecisionVolume) DecisionVolume->BlendWeight = DecisionWeight;

	// weather targets
	const float TWet = Weather == ELSWeather::Rain ? 1.f : 0.f;
	const float TDust = Weather == ELSWeather::Dust ? 1.f : 0.f;
	const float TFog = Weather == ELSWeather::Fog ? 1.f : Weather == ELSWeather::Dust ? 0.6f : 0.f;
	const float Rate = RealDt / FMath::Max(0.1f, WeatherBlendSeconds);
	Wetness = FMath::FInterpConstantTo(Wetness, TWet, RealDt, 1.f / FMath::Max(0.1f, WeatherBlendSeconds));
	Puddles = FMath::FInterpConstantTo(Puddles, TWet, RealDt, 0.5f / FMath::Max(0.1f, WeatherBlendSeconds));   // puddles form slower than surfaces get wet
	Dust = FMath::Clamp(Dust + (TDust - Dust) * Rate * 3.f, 0.f, 1.f);
	Fog = FMath::Clamp(Fog + (TFog - Fog) * Rate * 3.f, 0.f, 1.f);

	if (WeatherMPC)
	{
		UKismetMaterialLibrary::SetScalarParameterValue(this, WeatherMPC, TEXT("Wetness"), Wetness);
		UKismetMaterialLibrary::SetScalarParameterValue(this, WeatherMPC, TEXT("Puddles"), Puddles);
		UKismetMaterialLibrary::SetScalarParameterValue(this, WeatherMPC, TEXT("Dust"), Dust);
		UKismetMaterialLibrary::SetScalarParameterValue(this, WeatherMPC, TEXT("FogDensity"), Fog);
	}
}

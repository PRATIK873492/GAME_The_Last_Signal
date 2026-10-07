#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameTheory/GameTheoryTypes.h"
#include "WorldStateVisuals.generated.h"

class UMaterialParameterCollection;
class APostProcessVolume;

/** Weather states the visual layer can show. Matches the web build: clear, rain, fog, dust. */
UENUM(BlueprintType)
enum class ELSWeather : uint8
{
	Clear,
	Rain,
	Fog,
	Dust
};

/**
 * Turns game-theory state into visuals, so the theory code never touches rendering.
 *  - Weather: writes Wetness / Puddles / Dust / FogDensity into MPC_Weather (read by every surface material).
 *    A dead river (Chapter 3) forces dust for the rest of the game.
 *  - Decision screen: slow motion + blends PPV_Decision (desaturated, vignette, depth of field) in and out.
 *  - Colony reactions: after every round, fires a Blueprint event with the colony's hostility.
 * Place one in each level (BP_WorldStateVisuals) and assign the MPC and the decision volume.
 */
UCLASS(Blueprintable)
class LASTSIGNAL_API AWorldStateVisuals : public AActor
{
	GENERATED_BODY()

public:
	AWorldStateVisuals();

	/** MPC_Weather with scalar parameters Wetness, Puddles, Dust, FogDensity. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Visuals")
	TObjectPtr<UMaterialParameterCollection> WeatherMPC = nullptr;

	/** PPV_Decision: unbound, BlendWeight 0 in the level. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Visuals")
	TObjectPtr<APostProcessVolume> DecisionVolume = nullptr;

	/** Time dilation while a decision screen is open. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Visuals", meta = (ClampMin = "0.01", ClampMax = "1"))
	float DecisionTimeDilation = 0.15f;

	/** Seconds for weather to blend from one state to the next. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Visuals", meta = (ClampMin = "0.1"))
	float WeatherBlendSeconds = 20.f;

	UFUNCTION(BlueprintCallable, Category = "Visuals")
	void SetWeather(ELSWeather NewWeather);

	UFUNCTION(BlueprintPure, Category = "Visuals")
	ELSWeather GetWeather() const { return Weather; }

	/** Call when the decision widget opens / closes. */
	UFUNCTION(BlueprintCallable, Category = "Visuals")
	void BeginDecision();

	UFUNCTION(BlueprintCallable, Category = "Visuals")
	void EndDecision();

	/** Implement in BP: play a leader montage, spawn guards when Hostility >= 3, etc. */
	UFUNCTION(BlueprintImplementableEvent, Category = "Visuals")
	void OnColonyReaction(EColony Colony, bool bPlayerCooperated, int32 Hostility);

protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float DeltaSeconds) override;

	UFUNCTION()
	void HandleRound(EColony Colony, const FRoundRecord& Record);

private:
	class UGameTheorySubsystem* GetGT() const;

	ELSWeather Weather = ELSWeather::Clear;
	// current blended values (0..1)
	float Wetness = 0.f, Puddles = 0.f, Dust = 0.f, Fog = 0.f;
	float DecisionTarget = 0.f, DecisionWeight = 0.f;
};

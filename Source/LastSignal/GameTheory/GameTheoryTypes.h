#pragma once

#include "CoreMinimal.h"
#include "Engine/DataTable.h"
#include "GameTheoryTypes.generated.h"

/** The four colonies of Solace City. Lakeside is the player's colony. */
UENUM(BlueprintType)
enum class EColony : uint8
{
	Lakeside	UMETA(DisplayName = "Lakeside (Water)"),
	Ironside	UMETA(DisplayName = "Ironside Refinery (Fuel)"),
	Mercy		UMETA(DisplayName = "Mercy Hospital (Medicine)"),
	Crows		UMETA(DisplayName = "Crow's Market (Food)")
};

/**
 * A move in any 2x2 game.
 * Index 0 is always the "cooperative" action (Cooperate / Swerve / Stag),
 * index 1 is the "selfish" action (Defect / Stay / Hare).
 * The on-screen label comes from the payoff matrix Data Table, so one enum serves every chapter.
 */
UENUM(BlueprintType)
enum class EGTAction : uint8
{
	Cooperate	UMETA(DisplayName = "Cooperate (action 0)"),
	Defect		UMETA(DisplayName = "Defect (action 1)")
};

/** Water extraction level for the Tragedy of the Commons (Chapter 3). */
UENUM(BlueprintType)
enum class EExtraction : uint8
{
	Low,
	Medium,
	High
};

/** One round of a 2x2 game between the player and one AI colony. */
USTRUCT(BlueprintType)
struct FRoundRecord
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "GameTheory")
	EGTAction PlayerAction = EGTAction::Cooperate;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "GameTheory")
	EGTAction AIAction = EGTAction::Cooperate;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "GameTheory")
	float PlayerPayoff = 0.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "GameTheory")
	float AIPayoff = 0.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "GameTheory")
	int32 Chapter = 0;
};

/** Full memory of one colony: every round it has played against the player. */
USTRUCT(BlueprintType)
struct FColonyHistory
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "GameTheory")
	TArray<FRoundRecord> Rounds;
};

/**
 * A 2x2 payoff matrix. This is also a Data Table row, so every chapter's game
 * can be edited in the editor without touching code.
 *
 * Naming: first letter = PLAYER's action, second letter = AI's action.
 *   CD_Player = what the player gets when the player Cooperates and the AI Defects (the "Sucker" payoff S).
 *
 * Defaults are the standard Prisoner's Dilemma: T=5, R=3, P=1, S=0.
 */
USTRUCT(BlueprintType)
struct FPayoffMatrix : public FTableRowBase
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs")
	FText GameName = FText::FromString(TEXT("Prisoner's Dilemma"));

	/** Label for action 0, e.g. "Send Full Shipment", "Swerve", "Hunt the Stag". */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs")
	FText Action0Label = FText::FromString(TEXT("Cooperate"));

	/** Label for action 1, e.g. "Send Fake Shipment", "Stay", "Grab the Hare". */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs")
	FText Action1Label = FText::FromString(TEXT("Defect"));

	/** One-sentence concept explanation shown under the matrix. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs", meta = (MultiLine = true))
	FText Explanation;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs") float CC_Player = 3.f; // R
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs") float CC_AI = 3.f;     // R
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs") float CD_Player = 0.f; // S
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs") float CD_AI = 5.f;     // T
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs") float DC_Player = 5.f; // T
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs") float DC_AI = 0.f;     // S
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs") float DD_Player = 1.f; // P
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Payoffs") float DD_AI = 1.f;     // P

	/** Payoff to the player for a given pair of actions. */
	float GetPlayerPayoff(EGTAction Player, EGTAction AI) const
	{
		const bool bPC = Player == EGTAction::Cooperate;
		const bool bAC = AI == EGTAction::Cooperate;
		return bPC ? (bAC ? CC_Player : CD_Player) : (bAC ? DC_Player : DD_Player);
	}

	/** Payoff to the AI for a given pair of actions. */
	float GetAIPayoff(EGTAction Player, EGTAction AI) const
	{
		const bool bPC = Player == EGTAction::Cooperate;
		const bool bAC = AI == EGTAction::Cooperate;
		return bPC ? (bAC ? CC_AI : CD_AI) : (bAC ? DC_AI : DD_AI);
	}

	/**
	 * True if this matrix is a valid Prisoner's Dilemma for the player:
	 * T > R > P > S  and  2R > T + S (so alternating C/D cannot beat steady cooperation).
	 */
	bool IsPrisonersDilemma() const
	{
		const float T = DC_Player, R = CC_Player, P = DD_Player, S = CD_Player;
		return T > R && R > P && P > S && 2.f * R > T + S;
	}
};

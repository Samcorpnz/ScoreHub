-- CreateTable
CREATE TABLE "MatchEvent" (
    "seq" BIGSERIAL NOT NULL,
    "matchId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "MatchEvent_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_seq_idx" ON "MatchEvent"("matchId", "seq");

-- AddForeignKey
ALTER TABLE "MatchEvent" ADD CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

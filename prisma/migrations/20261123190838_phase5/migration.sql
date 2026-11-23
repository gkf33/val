-- AlterTable
ALTER TABLE "NameChangeRequest" ADD COLUMN     "partyId" TEXT;

-- AlterTable
ALTER TABLE "Party" ADD COLUMN     "anonymizedAt" TIMESTAMP(3);

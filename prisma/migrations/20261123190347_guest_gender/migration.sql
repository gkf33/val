-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('m', 'w', 'd');

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "gender" "Gender";

-- AlterTable
ALTER TABLE "NameChangeRequest" ADD COLUMN     "newGender" "Gender";

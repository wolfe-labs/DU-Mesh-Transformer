export function findCommonWords(a: string, b: string) {
  const aChars = a.split('');
  const bChars = b.split('');

  aChars[0] = aChars[0].toUpperCase();
  bChars[0] = bChars[0].toUpperCase();

  a = aChars.join('');
  b = bChars.join('');

  const wordsA = Array.from(a.matchAll(/([A-Z_]+[a-z0-9]+)/g)).map(match => match[0]);
  const wordsB = Array.from(b.matchAll(/([A-Z_]+[a-z0-9]+)/g)).map(match => match[0]);

  const wordsASet = new Set(wordsA);
  const wordsBSet = new Set(wordsB);
  const commonWordsSet = new Set();
  wordsASet.forEach(word => wordsBSet.has(word) && commonWordsSet.add(word));
  wordsBSet.forEach(word => wordsASet.has(word) && commonWordsSet.add(word));

  const result = [];
  for (let indexA = 0, indexB = 0; indexA < Math.max(wordsA.length, wordsB.length); indexA++, indexB++) {
    if (!commonWordsSet.has(wordsA[indexA]) && !commonWordsSet.has(wordsB[indexB])) {
      indexA++;
    } else if (!commonWordsSet.has(wordsA[indexA])) {
      indexA++;
    } else if (!commonWordsSet.has(wordsB[indexA])) {
      indexB++;
    }

    if (!wordsA[indexA] || !wordsB[indexB]) {
      break;
    }

    if (wordsA[indexA] != wordsB[indexB]) {
      if (wordsA[indexA + 1] == wordsB[indexB]) {
        indexA++;
      } else if (wordsA[indexA] == wordsB[indexB + 1]) {
        indexB++;
      } else {
        continue;
      }
    }

    result.push(wordsA[indexA]);
  }

  return result;
}
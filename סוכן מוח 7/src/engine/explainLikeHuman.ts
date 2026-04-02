export function explainLikeHuman(professionalText: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/CTR/gi, 'אחוז עצירה והקלקה'],
    [/CPA/gi, 'עלות לתוצאה'],
    [/ROAS/gi, 'החזר על ההוצאה'],
    [/creative/gi, 'הקריאייטיב'],
    [/landing page/gi, 'דף הנחיתה'],
    [/audience/gi, 'הקהל'],
    [/offer/gi, 'ההצעה']
  ];

  let text = professionalText;
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

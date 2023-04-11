const MY_NUMBERS = [6, 15, 26, 27, 42, 19];
const MY_NUMBERS_SUBSET = MY_NUMBERS.slice(0, 5);

const MY_EMAIL_ADDRESS = "example@email.com";

const LOTTO_DIVISIONS = {
  "1": [6, "n/a"],
  "2": [5, true],
  "3": [5, false],
  "4": [4, true],
  "5": [4, false],
  "6": [3, true],
  "7": [3, false],
  "8": [2, true],
};

const POWERBALL_DIVISIONS = {
  "1": [5, true],
  "2": [5, false],
  "3": [4, true],
  "4": [4, false],
  "5": [3, true],
  "6": [3, false],
  "7": [2, true],
  "8": [1, true],
  "9": [0, true],
};

const FIRST_BALL_COLUMN = 5; // values start in column E

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getGameResults() {
  let today = new Date();

  
  // // Use this when you want to get a particular date's data
  // let todayYr = today.getFullYear();
  // let todayMonth = today.getMonth();
  // let todayDate = today.getDate();
  // today = new Date(todayYr, todayMonth, todayDate - 1);
  

  let resultsAvailable = false;
  let updatedSheet = null;

  const formattedDateForApi = formatDateForExternalApiRequest(today);
  const formattedDateForSheets = formatDateForInternalStoring(today);
  ["LOTTO", "LOTTOPLUS", "LOTTOPLUS2", "POWERBALL", "POWERBALLPLUS"].forEach(
    (game) => {
      const results = fetchDrawResults(game, formattedDateForApi);
      if (results) {
        updatedSheet = presentGameResults(game, formattedDateForSheets, results);
        resultsAvailable = true;
      }
    }
  );

  if (resultsAvailable) {
    const emailBody = createEmailBody(updatedSheet, formattedDateForSheets);
    MailApp.sendEmail({
      to: MY_EMAIL_ADDRESS,
      subject: `Lotto results for ${formattedDateForSheets}`,
      htmlBody: emailBody,
    });
  }
}

function presentGameResults(title, drawDate, { drawId, balls: results }) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheets()[0];

  insertNewRow(sheet, drawDate);

  setDrawId(sheet, 1, drawId);
  setDrawDate(sheet, 1, drawDate);
  setGameTitle(sheet, 1, title);

  results.forEach((v, i) => {
    const colNum = i + FIRST_BALL_COLUMN;
    const cell = sheet.getRange(`${getAlphabetLetter(colNum)}1`);
    cell.setValue(v);

    if ((i + 1) === results.length) { // Powerball or bonus ball
      // A bonus ball doesn't count as a "normal" 6th ball
      // If you match 5 "normal" numbers and the bonus ball,
      // it counts less than matching the 6 "normal" numbers
      if (isLotto(title)) {
        if (MY_NUMBERS.includes(v)) cell.setBackground("yellow");
      } else {
        const lastOfMyNumbers = MY_NUMBERS[MY_NUMBERS.length - 1];
        // Powerball selections have to match (i.e. order matters
        // for the last ball)
        if (v === lastOfMyNumbers) cell.setBackground("yellow");
      }
    } else {
      let comparisonNumbers;
      if (isLotto(title)) comparisonNumbers = MY_NUMBERS;
      // If I chose 19 as my powerball but 19 shows up as a "normal"
      // ball, my selection does not count
      else comparisonNumbers = MY_NUMBERS_SUBSET;

      if (comparisonNumbers.includes(v)) cell.setBackground("lime");
    }
  });

  return sheet;
}

function insertNewRow(sheet, drawDate) {
  const augmentingTodaysResults = checkIfAugmentingTodaysResults(sheet, drawDate);
  // We must clear the background on the rows we insert otherwise they inherit
  // background colours from the row below them 
  if (augmentingTodaysResults) {
    sheet.insertRowBefore(1);
    getFullRange(sheet, 1).setBackground(null);
  } else {
    sheet.insertRowsBefore(1, 2);
    getFullRange(sheet, 1, 2).setBackground(null);
  }
}

// Lotto expects dates in the form dd/mm/yyyy
function formatDateForExternalApiRequest(dt) {
  const yyyy = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const d = dt.getDate(); 

  const mm = m < 10 ? `0${m}` : m;
  const dd = d < 10 ? `0${d}` : d;

  return `${dd}/${mm}/${yyyy}`;
}

// To avoid the American mm/dd/yyyy and dd/mm/yyyy confusion for me
// myself and I, I thought it would be better to rather use
// dd MMM yyyy in the spreadsheet
function formatDateForInternalStoring(dt) {
  const yyyy = dt.getFullYear();
  const m = dt.getMonth();
  const d = dt.getDate(); 

  const MMM = MONTHS[m];
  const dd = d < 10 ? `0${d}` : d;

  return `${dd} ${MMM} ${yyyy}`;
}

// i is not zero-indexed
// assumes we will not go over 26
function getAlphabetLetter(i) {
  return String.fromCharCode(i + 64);
}

function checkIfAugmentingTodaysResults(sheet, drawDate) {
  const dt = getDrawDate(sheet, 1);
  if (!dt) return false;

  return areSameDates(dt, drawDate);
}

function fetchDrawResults(title, drawDate) {
  const url = "https://www.nationallottery.co.za/index.php?task=results.getHistoricalData&amp;option=com_weaver";
  const body = {
    method: "post",
    payload: `gameName=${title}&startDate=${drawDate}&endDate=${drawDate}&offset=0&limit=1`,
  };

  const data = fetchWithRetry(url, body);

  if (data?.[0]) {
    const ballArr = [];
    let indices = [1, 2, 3, 4, 5];
    let specialBall;

    if (isLotto(title)) {
      indices.push(6);
      specialBall = data[0].bonusBall;
    } else if (isPowerball(title)) {
      specialBall = data[0].powerball;
    } else {
      return;
    }

    indices.forEach((n) => {
      ballArr.push(parseInt(data[0][`ball${n}`]));
    });
    ballArr.sort((a, b) => a - b);
    ballArr.push(parseInt(specialBall));

    return {
      drawId: data[0].drawNumber,
      balls: ballArr,
    };
  }

  return;
}

const fetchWithRetry = (url, body, nthTry = 0, numRetries = 3) => {
  try {
    const response = UrlFetchApp.fetch(url, body);
    const json = response.getContentText();

    const { data } = JSON.parse(json);

    return data;
  } catch(ex) {
    Logger.log("Error occurred with fetching" + ex);
    if (++nthTry < numRetries) {
      Utilities.sleep(3000);
      fetchWithRetry(url, nthTry, numRetries);
    } else {
      Logger.log("Yoh ha ah; we are at our max now");
    }
  }
}

const greetings = [
 "Howzit?", "Heita!", "Aweh!", "Sawubona.", "Molo.", "Unjani?",
 "Thobela!", "Dumela!", "Hoe gaan dit?", "Sharp fede ✌",
];

function createEmailBody(resultsSheet, drawDate) {
  const i = Math.floor(Math.random() * 10);
  const greeting = greetings[i];

  let body = `<p>${greeting}</p>`
    + "<p>Here are the latest results, with your numbers highlighted:</p>"
    + "<div>"

  let rowNum = 1;
  let stillOnTodaysResults = true;

  while (stillOnTodaysResults) {
    const resultDate = getDrawDate(resultsSheet, rowNum);

    if (!resultDate || !areSameDates(resultDate, drawDate)) {
      stillOnTodaysResults = false;
    } else {
      const gameTitle = getGameTitle(resultsSheet, rowNum);

      body += `<h2>${gameTitle}</h2>`;
      body += '<div style="margin-left: 12px;">';

      let col = FIRST_BALL_COLUMN;
      const spanElms = [];

      while (true) {
        colName = getAlphabetLetter(col);
        const cell = resultsSheet
          .getRange(`${colName}${rowNum}`);

        if (cell.isBlank()) break;

        const value = cell.getValue();
        const bgColour = cell.getBackground();
        let ballStyle = getBallStyling();
        if (bgColour !== "#ffffff") {
          ballStyle += `background-color: ${bgColour}`;
        }

        spanElms.push(`<span style="${ballStyle}">${
          value < 10 ? ("0" + value) : value
        }</span>`);
        col++;
      }

      let lastSpanElm = spanElms
        .pop()
        .replace(
          /margin-left:\s?\d+px/,
          "margin-left: 18px"
        );
      spanElms.push(lastSpanElm);
      body += spanElms.join("");

      // Tell user which division they are in, if any
      const drawId = getDrawId(resultsSheet, rowNum);

      const payouts = fetchDrawDetails(gameTitle, drawId);
      const aggResult = aggregateResult(gameTitle, getBallRange(resultsSheet, rowNum));
      const division = determineDivision(gameTitle, aggResult);
      if (division) {
        body += "<p>Congrats!  "
        body += `You are in division ${division} and will be paid R${payouts[division.toString()]}.</p>`;
      } else {
        body += '<p style="font-size: 0.5rem;">You didn\'t make it into any winning divisions :(</p>';
      }

      body += "</div>";
      rowNum++;
    }
  }

  body += '<p style="margin-top:36px;">Regards,'
    + "<br>The Lotto bot</p>";

  return body;
}

function getBallStyling() {
  return "display: inline-block;"
  + "border: 1px solid black;"
  + "width: 20px;"
  + "text-align: center;"
  + "padding: 6px;"
  + "border-radius: 50% / 50%;"
  + "margin-left: 6px;";
}

function fetchDrawDetails(title, drawId) {
  const url = "https://www.nationallottery.co.za/index.php?task=results.redirectPageURL&amp;option=com_weaver";
  const body = {
    method: "post",
    payload: `gameName=${title}&drawNumber=${drawId}`,
  };

  const { drawDetails : details } = fetchWithRetry(url, body);

  let numDivisions;
  if (isLotto(title)) numDivisions = 8;
  else numDivisions = 9;

  const divPayouts = {};
  for (let i = 1; i <= numDivisions; i++) {
    divPayouts[`${i}`] = details[`div${i}Payout`];
  }

  return divPayouts;
}

function aggregateResult(title, resultRange) {
  const aggregate = [0, false];

  let col = 1;
  const lastCol = resultRange
    .getValues()[0]
    .length;

  while (col <= lastCol) {
    const cell = resultRange.getCell(1, col);
    if (cell.isBlank()) break;

    const bgColour = cell.getBackground();
    switch (bgColour) {
      case "#ffff00": // yellow
        aggregate[1] = true;
        break;

      case "#00ff00": // lime
        aggregate[0]++;
        break;
    }

    col++;
  }

  if (isLotto(title) && aggregate[0] === 6) {
    aggregate[1] = "n/a";
  }

  return aggregate;
}

function determineDivision(gameTitle, aggregateResult) {
  const divisions = isLotto(gameTitle) ? LOTTO_DIVISIONS : POWERBALL_DIVISIONS;
  const matchingDiv = Object.entries(divisions)
    .find(([div, requiredResult]) => requiredResult[0] === aggregateResult[0]
        && requiredResult[1] === aggregateResult[1]);

  return matchingDiv?.[0];
}

function isLotto(gameTitle) {
  return gameTitle.toLowerCase().includes("lotto");
}

function isPowerball(gameTitle) {
  return gameTitle.toLowerCase().includes("powerball");
}

function areSameDates(dateObj, dateddmmyyyy) {
  return formatDateForInternalStoring(dateObj) === dateddmmyyyy;
}

function getDrawId(sheet, rowNum) {
  return sheet.getRange(`A${rowNum}`).getValue();
}

function setDrawId(sheet, rowNum, id) {
  sheet.getRange(`A${rowNum}`).setValue(id);
}

function getDrawDate(sheet, rowNum) {
  return sheet.getRange(`B${rowNum}`).getValue();
}

function setDrawDate(sheet, rowNum, dt) {
  sheet.getRange(`B${rowNum}`).setValue(dt);
}

function getGameTitle(sheet, rowNum) {
  return sheet.getRange(`C${rowNum}`).getValue();
}

function setGameTitle(sheet, rowNum, title) {
  sheet.getRange(`C${rowNum}`).setValue(title);
}

function getBallRange(sheet, rowNum) {
  return sheet.getRange(`E${rowNum}:K${rowNum}`);
}

function getFullRange(sheet, startRowNum, endRowNum) {
  return sheet.getRange(`A${startRowNum}:K${endRowNum ?? startRowNum}`);
}
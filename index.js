// run this file using login credentials for Imagine Math:
//  > node index.js [username] [password] [start-index] [end-index]
//  username & password can also be stored in process env variables
//  default start-index = 0, default end-index = 1000

// library imports
const dotenv = require('dotenv').config();
const puppeteer = require("puppeteer");
const fs = require("fs");
const dfs = require('dropbox-fs')({ apiKey: process.env.DROPBOX_API_KEY });
const winston = require("winston");
const express = require("express");
const moment = require("moment");

const app = express();

const PORT = process.env.PORT || 3000;

// constants
const IMAGINE_MATH_USERNAME =
  process.env.IMAGINE_MATH_USERNAME || process.argv[2];
const IMAGINE_MATH_PASSWORD =
  process.env.IMAGINE_MATH_PASSWORD || process.argv[3];
const FIRST_STUDENT_TO_CRAWL = process.argv[4] || 0; // 0 to start at beginning
const LAST_STUDENT_TO_CRAWL = process.argv[5] || 1000; // greater than max number of students to go through the end

let students = [];

// set up logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({
      filename: `${__dirname}/logs/error.log`,
      level: "error",
      timestamp: true
    }),
    new winston.transports.File({
      filename: `${__dirname}/logs/combined.log`,
      timestamp: true
    })
  ]
});

//if (process.env.NODE_ENV !== 'production') {
logger.add(
  new winston.transports.Console({
    format: winston.format.simple()
  })
);
//}

// start server
app.listen(PORT, () => {
 logger.info(`Our app is running on port ${PORT}`);
});

// HELPER FUNCTIONS

// helper function for async delay
function delay(timeout) {
  return new Promise(resolve => {
    setTimeout(resolve, timeout);
  });
}

// helper function to traverse array asynchronously
async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

// helper function to upload to Dropbox
function dropboxUploadScreenshotPromise(screenShotResult, dropboxPathAndFileName) {
  return new Promise(function(res, rej){
    dfs.writeFile(dropboxPathAndFileName, screenShotResult, {encoding: 'utf8'}, (err, stat) => {
      if (err) {
        logger.error('Upload to dropbox failed', err);
        rej(err);
      }
      logger.info('File successfully saved to dropbox: ' + stat.name);
      res(stat.name)
    })
  })
}


async function getDateOfLastCrawl() {
  return dropboxReadPromise('/last-successful-crawl.json');
}

function dropboxReadPromise(path) {
  return new Promise(function(res, rej){
    dfs.readFile(path, {encoding: 'utf8'}, (err, result) => {
      if (err) {
        logger.error('Unable to read file in Dropbox', err);
        rej(err);
      }
      res(result.slice(1, -1));
    })
  })
}

// helper function to screenshot only one DOM element
async function screenshotDOMElement(page, selector, padding = 0, path) {
  const rect = await page.evaluate(selector => {
    const element = document.querySelector(selector);
    const { x, y, width, height } = element.getBoundingClientRect();
    return { left: x, top: y, width, height, id: element.id };
  }, selector);

  let elementScreenshot = await page.screenshot({
    clip: {
      x: rect.left - padding,
      y: rect.top - padding,
      width: rect.width + padding * 2,
      height: rect.height + padding * 2
    }
  });

  if (elementScreenshot) {
    return dropboxUploadScreenshotPromise(elementScreenshot, path);
  } else {
    return null;
  }
}

// helper function to convert array of objects to csv format
function objectArrayToCSV(data = null, columnDelimiter = ",", lineDelimiter = "\n") {
	let result, ctr, keys

	if (data === null || !data.length) {
		return null
	}

	keys = Object.keys(data[0])

	result = ""
	result += keys.join(columnDelimiter)
	result += lineDelimiter

	data.forEach(item => {
		ctr = 0
		keys.forEach(key => {
			if (ctr > 0) {
				result += columnDelimiter
			}

			result += typeof item[key] === "string" && item[key].includes(columnDelimiter) ? `"${item[key]}"` : item[key]
			ctr++
		})
		result += lineDelimiter
	})

	return result
}

// class to store student information from Imagine Math crawl
class StudentInfo {
  constructor(
    first,
    last,
    grade,
    period,
    studentProgressLink,
    fullName = "",
    mostRecentCertificateUrl = "",
    studentAvatarSVGUrl = "",
    dateCrawled = "",
    profileId = ""
  ) {
    this.first = first;
    this.last = last;
    this.grade = grade;
    this.period = period;
    this.studentProgressLink = studentProgressLink;
    this.fullName = fullName;
    this.mostRecentCertificateUrl = mostRecentCertificateUrl;
    this.studentAvatarSVGUrl = studentAvatarSVGUrl;
    this.dateCrawled = dateCrawled;
    this.profileId = profileId;
  }
}

// main app function, asynchronously log on, crawl each students' profile page for most recent certificate & avatar

async function scrapeStudentProfiles() {
  logger.info("Async scrape started");

  if (IMAGINE_MATH_USERNAME == "" || IMAGINE_MATH_PASSWORD == "") {
    logger.error(
      "Must pass Imagine Math username & password as arguments:> node index.js [username] [password], or using process.env variables"
    );
    return;
  }

  // initialize puppeteer tools
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  logger.info("Browser started");

  // go to log in page
  await page.goto("https://math.imaginelearning.com/");

  // log in
  await page.type("#student_username", IMAGINE_MATH_USERNAME);
  await page.type("#student_password", IMAGINE_MATH_PASSWORD);
  await page.click("#btn_student_sign_in");
  await page.waitForNavigation();

  // - grab last crawl date
  let startDateForReportSearch = await getDateOfLastCrawl();
  // set last date of current crawl to yesterday
  let endDateForReportSearch = moment().subtract(1, 'days').format('YYYY-M-D');

  // build array of students with new certificates to cross-reference
  let studentProfileIDsForRecentCertificates = [];

  try {
    // - go to imagine math report for all passed lessons since previous crawl
    const recentUsageReportUrl = `https://math.imaginelearning.com/reports/overview_report#level_to_show=student&start_date=${startDateForReportSearch}&end_date=${endDateForReportSearch}&page=1&rows_per_page=400&order_by=total_lessons_passed&sort=desc`
    await page.goto(recentUsageReportUrl);
    await page.waitForSelector("tr.overview-report--student", { timeout: 15000 });
    
    // select all the tr.overview-report--student rows
    studentProfileIDsForRecentCertificates = await page.evaluate(() => {
       let reportRows = [
         ...document.querySelectorAll("tr.overview-report--student")
       ];
       return reportRows.filter(row => {
          // skip rows that do not have a passed lesson within this date range
          let passedLessons = row.querySelectorAll("td")[4].innerText;
          return ( passedLessons > 0 );            
       }).map(row => {
          // return studentId to add to profile link
          let studentIdLink = row.querySelector('a.indicator-expandClassrooms');
          return studentIdLink.getAttribute("data-student"); {
         }
       });
    });

    logger.info("Crawl for following students with recent certificates: " + studentProfileIDsForRecentCertificates);

  } catch (error) {
    logger.error(error);
    return;
  }  

  // fetch json data of all student profile pages:
  let rawStudentData = fs.readFileSync(
    `${__dirname}/student-profile-data/student-data.json`
  );
  let studentData = JSON.parse(rawStudentData);
  await asyncForEach(studentData, async (item, index) => {
    
    // break to next student for any outside of the index passed in args
    if (index < FIRST_STUDENT_TO_CRAWL - 1 || index > LAST_STUDENT_TO_CRAWL - 1)
      return;
    
    let student = new StudentInfo(
      item.First,
      item.Last,
      item.Grade,
      item["Math Period"],
      item["Student Progress Link"]
    );

    // break for any student with no profile link
    if (student.studentProgressLink.length == 0) return;
    
    // break for any student with no recent certificate 
    // (compare subset of profile link to ID in array of recent certificates)
    student.ProfileId = student.studentProgressLink.substr(student.studentProgressLink.length - 8);
    if (!studentProfileIDsForRecentCertificates.includes(student.ProfileId)) return;

    try {
      // go to each student profile page
      await page.goto(student.studentProgressLink);
      await page.waitForSelector(".lessonActivity--certificate > a", {
        timeout: 15000
      });
    } catch(error) {
      logger.info(`No certificate found for ${student.first} ${student.last} (${student.grade})`);
      return;
    }

    try {
    
      // select all the .lessonActivity--certificate spans that have an anchor tag (the lessons with certificates)
      let certificateLinks = await page.evaluate(() => {
        let links = [
          ...document.querySelectorAll(".lessonActivity--certificate > a")
        ];
        return links.map(link => link.href);
      });
      student.mostRecentCertificateUrl = certificateLinks.pop();

      // access certificate page with avatar
      await page.goto(student.mostRecentCertificateUrl);
      await page.waitForSelector(".name", { timeout: 10000 });
      student.fullName = await page.evaluate(() => {
        return document.querySelector(".name").innerHTML;
      });
      // save screenshot of most recent certificate (only the certificate selector)
      await screenshotDOMElement(
        page,
        ".frame",
        0,
        `/crawled-certificates/${student.grade}-${student.last}-${student.first}-most-recent-certificate.png`
      );

      // get link to avatar SVG
      student.studentAvatarSVGUrl = await page.evaluate(() => {
        return (avatarImg = document.querySelector("div.avatar > img").src);
      });

      // download avatar SVG to a folder
      await page.goto(student.studentAvatarSVGUrl);
      let svgInline = await page.evaluate(
        () => document.querySelector("svg").outerHTML
      );
      dfs.writeFile(
        `/crawled-avatars/${student.grade}-${student.last}-${student.first}-avatar.svg`,
        svgInline,
        {encoding: 'utf8'},
        (err, stat) => {
          if (err) {
            logger.error("Upload to Dropbox failed for SVG file", err);
          } else {
            logger.info("File successfully saved to dropbox: " + stat.name);
          }
        }
      );
    } catch (error) {
      logger.error(
        `Error crawling student profile for ${student.first} ${student.last}: `, error
      );
    } finally {        
      student.dateCrawled = new Date().toISOString().slice(0, 19);
      students.push(student);
      await delay(10000);
    }

    // continue loop for all other students
  });

  await browser.close();
  logger.info("Browser closed");
};



// call the function to perform the scrape

scrapeStudentProfiles()
  .catch(error => {
       logger.error(error);
  })
  .finally(() => {

    dfs.writeFile(
      `/crawl-log-${new Date().toISOString().slice(0, 19)}.csv`,
      objectArrayToCSV(students),
      {encoding: 'utf8'},
      (err, stat) => {
        if (err) {
          logger.error("Upload to Dropbox failed for CSV file of crawl: ", err);
          return;
        }
        logger.info("CSV log successfully saved to dropbox: " + stat.name);
      }
    );

    dfs.writeFile(
      `/last-successful-crawl.json`,
      moment().format("YYYY-M-D"),
      {encoding: 'utf8'},
      (err, stat) => {
        if (err) {
          logger.error("Upload to Dropbox failed to store last successful crawl: ", err);
          return;
        }
        logger.info("Crawl date successfully saved to dropbox: " + stat.name);
      }
    );

    logger.info("End of crawl.");
  });

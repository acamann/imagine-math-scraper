// run this file using login credentials for Imagine Math:
//  > node index.js [username] [password]

// libraries
const puppeteer = require('puppeteer');
const fs = require('fs');
const winston = require('winston');

// constants
const FIRST_STUDENT_TO_CRAWL = 300;
const LAST_STUDENT_TO_CRAWL = 305;
const IMAGINE_MATH_USERNAME = process.argv[2];
const IMAGINE_MATH_PASSWORD = process.argv[3];

let students = [];

// set up logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'user-service' },
    transports: [
      //
      // - Write to all logs with level `info` and below to `combined.log` 
      // - Write all logs error (and below) to `error.log`.
      //
      new winston.transports.File({ filename: 'error.log', level: 'error' }),
      new winston.transports.File({ filename: 'combined.log' })
    ]
  });
   
  //
  // If we're not in production then log to the `console` with the format:
  // `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
  // 
  if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
      format: winston.format.simple()
    }));
  }


function delay(timeout) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
}

class StudentInfo {
    constructor (first, last, grade, period, studentProgressLink, fullName = "", mostRecentCertificateUrl = "", studentAvatarSVGUrl = "", dateCrawled = "") {
        this.first = first;
        this.last = last;
        this.grade = grade;
        this.period = period;
        this.studentProgressLink = studentProgressLink;
        this.fullName = fullName;
        this.mostRecentCertificateUrl = mostRecentCertificateUrl;
        this.studentAvatarSVGUrl = studentAvatarSVGUrl;
        this.dateCrawled = dateCrawled;
    }
}

async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

var scrapeStudentProfiles = async () => {
    if (IMAGINE_MATH_USERNAME == "" || IMAGINE_MATH_PASSWORD == "") {
        logger.error("Must pass Imagine Math username & password as arguments:> node index.js [username] [password]");
        return;
    }

    const browser = await puppeteer.launch({ });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800});

    // go to log in page
    await page.goto('https://math.imaginelearning.com/');
    
    // log in
    await page.type('#student_username', IMAGINE_MATH_USERNAME);
    await page.type('#student_password', IMAGINE_MATH_PASSWORD);
    await page.click('#btn_student_sign_in');
    await page.waitForNavigation();

    // fetch json data of all student profile pages:
    let rawStudentData = fs.readFileSync("./student-profile-data/student-profile-links.json");
    let studentData = JSON.parse(rawStudentData);
    await asyncForEach(studentData, async (item, index) => {
        
        // control the subset of data to crawl
        if (index < (FIRST_STUDENT_TO_CRAWL - 1) || index > (LAST_STUDENT_TO_CRAWL - 1)) return;

        let student = new StudentInfo(item.First, item.Last, item.Grade, item["Math Period"], item["Student Progress Link"]);
        if(student.studentProgressLink.length == 0) return;

        try {

            // go to each student profile page
            await page.goto(student.studentProgressLink);
            await page.waitForSelector('.lessonActivity--certificate > a', { timeout: 20000 });
            
            
            // select all the .lessonActivity--certificate spans that have an anchor tag (the lessons with certificates)
            let certificateLinks = await page.evaluate(() => {
                let links = [...document.querySelectorAll('.lessonActivity--certificate > a')];
                return links.map((link) => link.href);
            });
            student.mostRecentCertificateUrl = certificateLinks.pop();

            // access certificate page with avatar
            await page.goto(student.mostRecentCertificateUrl);
            await page.waitForSelector('.name', { timeout: 10000 });
            student.fullName = await page.evaluate(() => {
                return document.querySelector('.name').innerHTML;
            });
            // save screenshot of most recent certificate
            await page.screenshot({path: `crawled-certificates/${student.grade}-${student.last}-${student.first}-most-recent-certificate.png`});

            // get link to avatar SVG
            student.studentAvatarSVGUrl = await page.evaluate(() => {
                return avatarImg = document.querySelector('div.avatar > img').src;
            })
            
            // download avatar SVG to a folder
            await page.goto(student.studentAvatarSVGUrl);
            let svgInline = await page.evaluate(() => document.querySelector('svg').outerHTML);
            fs.writeFile(`crawled-avatars/${student.grade}-${student.last}-${student.first}-avatar.svg`, svgInline, (err) => {
                if (err) {
                    logger.error(err);
                    return;
                }
                logger.info(`SVG successfully saved for ${student.fullName} (index: ${index})`);
            });

            

        } catch (error) {            
            await page.screenshot({path: `test-screenshots/Error-${student.grade}-${student.last}-${student.first}.png`});
            logger.error(`Error crawling student profile for ${student.first} ${student.last}: ` + error);
        }

        student.dateCrawled = Date(Date.now()).toString();

        students.push(student);
        logger.info(Object.values(student).join(","));

        // save new line to CSV file
        fs.appendFile('crawl-log.csv', Object.values(student).join(",") + ', \r\n', function (err) {
            if (err) {
                logger.error(err);
                return;
            }
        });
        await delay(10000);

        // continue loop for all other students
    });

    logger.info("Successfully completed crawl.");

    await browser.close();
};


scrapeStudentProfiles()
    .catch((error) => {
        logger.error(error);
        process.exit(1);
    });

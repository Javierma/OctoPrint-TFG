$(function() {
    function ScheduleViewModel(parameters) {
        var self = this;

        self.loginState = parameters[0];
        self.printerState = parameters[1];
        self.users = parameters[2];

        self.target = undefined;
        self.file = undefined;
        self.path = undefined;
        self.data = undefined;

        self.day = ko.observable();
        self.month = ko.observable();
        self.year = ko.observable();
        self.hour = ko.observable();
        self.minute = ko.observable();
        self.title = ko.observable();
        self.printSeparation = ko.observable(0);
        self.afterCurrentJob = ko.observable(false);
        self.repeatDaily = ko.observable(false);
        self.repeatWeekly = ko.observable(false);
        self.repeatMonthly = ko.observable(false);
        self.conflictsWith = ko.observable("No conflicts");
        self.alreadyScheduled = ko.observableArray();
        self.modifyJob = ko.observable(false);
        self.deleteJob = ko.observable(false);
        self.scheduleDateStart = undefined;
        self.selectedJob = ko.observable();
        self.daysOfWeek = ko.observableArray([{text: "Monday", number: 1},{text: "Tuesday", number: 2},{text: "Wednesday", number: 3},
                                              {text: "Thursday", number: 4},{text: "Friday", number: 5},{text: "Saturday", number: 6},
                                              {text: "Sunday", number: 0}]);
        self.dayOfWeek = ko.observable();

        const REPEAT_JOB_DAILY = 0;
        const REPEAT_JOB_WEEKLY = 1;
        const REPEAT_JOB_MONTHLY = 2;
        const SINGLE_JOB = 3;

        const REPEAT_SCHEDULE_DAILY = 4;
        const REPEAT_SCHEDULE_WEEKLY = 5;
        const REPEAT_SCHEDULE_MONTHLY = 6;
        const SINGLE_SCHEDULE = 7;

        self.enableSchedule = function(){
            return self.loginState.isUser();
        };

        self.initWindow = function(){
            self.printSeparation(1);
            self.afterCurrentJob(false);
            self.repeatDaily(false);
            self.repeatWeekly(false);
            self.repeatMonthly(false);
            self.conflictsWith("No conflicts");
            self.modifyJob(false);
            self.deleteJob(false);
            self.dayOfWeek(undefined);
            self.selectedJob(undefined);
        };

        self.show = function(target, file, path,estimatedPrintTime) {
            self.initWindow();
            self.estimatedPrintTime = estimatedPrintTime;
            if (!self.enableSchedule() && !force) {
                return;
            }

            var filename = file.substr(0, file.lastIndexOf("."));
            if (filename.lastIndexOf("/") != 0) {
                path = path || filename.substr(0, filename.lastIndexOf("/"));
                filename = filename.substr(filename.lastIndexOf("/") + 1);
            }
            self.requestData();
            if (self.alreadyScheduled().length > 0) {
                self.alreadyScheduled.removeAll();
                self.target = target;
                self.file = file;
                self.path = path;
                var date=new Date();
                self.day(date.getDate());
                self.month(date.getMonth()+1);
                self.year(date.getFullYear());
                self.hour(date.getHours());
                self.minute(date.getMinutes());
                self.title(_.sprintf(gettext("Schedule %(filename)s"), {filename: filename}));
                $("#schedule_configuration_dialog").modal("show");
            }
        };

        self.isValidDate = function(day,month,year) {
            if (month === 1 || month === 3 || month === 5 || month === 8 || month === 10) {
                if((month !=1 && day <= 30) || (month === 1 && ((year-2016)%4 === 0) && day <= 29) || (month === 1 && ((year-2016)%4!=0) &&
                   day <= 28)) {
                    return true;
                } else {
                    return false;
                }
            } else {
                return true;
            }
        };

        self.repetitionConflicts = function() {
           if ((!self.repeatDaily() && !self.repeatWeekly() && !self.repeatMonthly()) || (self.repeatDaily() && !self.repeatWeekly() && 
                !self.repeatMonthly()) || (!self.repeatDaily() && self.repeatWeekly() && !self.repeatMonthly()) || 
               (!self.repeatDaily() && !self.repeatWeekly() && self.repeatMonthly())) {
               return false;
           } else {
               return true;
           }
        };

        self.getJobRepetition = function(job) {
            if (job.jobStart["day_of_month"] != '*' && job.jobStart["month"] != '*' && job.jobStart["day_of_week"] != '*') {
                return SINGLE_JOB;
            }
            else if (job.jobStart["day_of_month"] === '*' && job.jobStart["month"] === '*' && job.jobStart["day_of_week"] === '*') {
                return REPEAT_JOB_DAILY;
            }
            else if (job.jobStart["day_of_month"] === '*' && job.jobStart["month"] === '*' && job.jobStart["day_of_week"] != '*') {
                return REPEAT_JOB_WEEKLY;
            }
            else {
                return REPEAT_JOB_MONTHLY;
            }
        };

        self.getScheduleRepetition = function() {
            if (!self.repeatDaily() && !self.repeatWeekly() && !self.repeatMonthly()) {
                return SINGLE_SCHEDULE;
            } else if (self.repeatDaily() && !self.repeatWeekly() && !self.repeatMonthly()) {
                return REPEAT_SCHEDULE_DAILY;
            } else if (!self.repeatDaily() && self.repeatWeekly() && !self.repeatMonthly()) {
                return REPEAT_SCHEDULE_WEEKLY;
            }
            else {
                return REPEAT_SCHEDULE_MONTHLY;
            }
        };

        self.allowModification = ko.computed(function() {
            var count = 0;
            var found = false;
            while ((count < self.alreadyScheduled().length) && !found)
            {
                if (self.alreadyScheduled()[count].filename === self.file){
                    found = true;
                } else {
                    count++;
                }
            }

            if (found){
                return true;
            } else {
                return false;
            }
        });

        self.conflicts = function() {
            var thereIsAConflict=false;
            var currentPrintEnd = undefined;
            if (self.data!=undefined && Object.keys(self.data).length > 0) {
                _.each(_.values(self.data), function(jobs) {
                    var hour = Number(jobs.jobStart["hour"]);
                    var minute = Number(jobs.jobStart["minute"]);
                    var month = undefined;
                    var day = undefined;
                    var dayOfWeek = undefined;
                    var jobStart = undefined;

                    if (self.isPrinting()) {
                        var printTimeLeft = self.printerState.printTimeLeft() * 1000;
                        currentPrintEnd = new Date().getTime() + printTimeLeft;
                    }

                    if (self.afterCurrentJob()) {
                        currentPrintEnd = new Date().getTime() + printTimeLeft;
                        self.scheduleDateStart = new Date(currentPrintEnd + (self.printSeparation() * 60 * 1000));
                    }

                    switch (self.getJobRepetition(jobs)) {
                        case SINGLE_JOB:
                            month = Number(jobs.jobStart["month"])-1;
                            day = Number(jobs.jobStart["day_of_month"]);
                            dayOfWeek = Number(jobs.jobStart["day_of_week"]);
                            jobStart = new Date(self.year(), month, day, hour, minute).getTime();

                            if(!self.afterCurrentJob()) {
                                switch (self.getScheduleRepetition()) {
                                    case SINGLE_SCHEDULE:
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(), self.minute())
                                                                          .getTime();
                                       break;

                                    case REPEAT_SCHEDULE_DAILY:
                                        self.scheduleDateStart = new Date(self.year(), month, day, self.hour(), self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_WEEKLY:
                                        var daysToSum = 0;
                                        if (self.dayOfWeek()!=undefined) {
                                            daysToSum = self.dayOfWeek().number - dayOfWeek;
                                        }
                                        self.scheduleDateStart = new Date(self.year(), month, day + daysToSum, self.hour(), self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_MONTHLY:
                                       self.scheduleDateStart = new Date(self.year(), month, self.day(), self.hour(), self.minute()).getTime();
                                       break;
                                }
                            }
                            break;

                        case REPEAT_JOB_DAILY:
                            month = self.month()-1;
                            day = self.day();
                            var daysToSum = 0;
                            jobStart = new Date(self.year(), self.month()-1, self.day(), hour, minute).getTime();
                            if(!self.afterCurrentJob()) {
                                switch (self.getScheduleRepetition()) {
                                    case SINGLE_SCHEDULE:
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(),
                                                                          self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_DAILY:
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(),
                                                                          self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_WEEKLY:
                                        dayOfWeek = new Date(jobStart).getDay();
                                        daysToSum = 0;
                                        if (self.dayOfWeek()!=undefined && dayOfWeek != self.dayOfWeek()) {
                                            daysToSum = self.dayOfWeek().number - dayOfWeek;
                                        }
                                        jobStart = new Date(self.year(), self.month()-1, self.day() + daysToSum, hour, minute).getTime();
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, Number(self.day()) + daysToSum, self.hour(),
                                                                          self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_MONTHLY:
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(),
                                                                          self.minute()).getTime();
                                        break;
                                }
                            }
                            break;

                        case REPEAT_JOB_WEEKLY:
                            month = self.month()-1;
                            day = self.day();
                            var daysToSum = 0;
                            dayOfWeek = Number(jobs.jobStart["day_of_week"]);
                            var currentDayOfWeek = new Date(self.year(), self.month()-1, self.day(), hour, minute).getDay();
                            daysToSum = currentDayOfWeek - dayOfWeek;
                            jobStart = new Date(self.year(), self.month()-1, Number(self.day())+daysToSum, hour, minute).getTime();

                            if(!self.afterCurrentJob()) {
                                switch (self.getScheduleRepetition()) {
                                    case SINGLE_SCHEDULE:
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(),
                                                                          self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_DAILY:
                                        daysToSum = 0;
                                        if (self.dayOfWeek()!=undefined) {
                                            daysToSum = self.dayOfWeek().number - dayOfWeek;
                                        }
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, Number(self.day()) + daysToSum, self.hour(),
                                                                          self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_WEEKLY:
                                        daysToSum = 0;
                                        if (self.dayOfWeek()!=undefined) {
                                            daysToSum = self.dayOfWeek().number - dayOfWeek;
                                        }
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, Number(self.day()) + daysToSum, self.hour(),
                                                                          self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_MONTHLY:
                                        while (new Date(self.year(),month,day,hour,minute).getDay() != dayOfWeek) {
                                            month = month +1;
                                        }
                                        self.scheduleDateStart = new Date(self.year(), month, day, self.hour(), self.minute()).getTime();
                                        jobStart = new Date(self.year(), month, self.day(), hour, minute).getTime();
                                        break;
                                }
                            }
                            break;

                        case REPEAT_JOB_MONTHLY:
                            day = Number(jobs.jobStart["day_of_month"]);
                            jobStart = new Date(self.year(), self.month()-1, day, hour, minute).getTime();
                            month = self.month()-1;

                            if(!self.afterCurrentJob()) {
                                switch (self.getScheduleRepetition()) {
                                    case SINGLE_SCHEDULE:
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(),
                                                                          self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_DAILY:
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, day, self.hour(), self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_WEEKLY:
                                        while (self.dayOfWeek() != undefined && new Date(self.year(), month, day, hour, minute).getDay() !=
                                               self.dayOfWeek().number) {
                                            month = month +1;
                                        }
                                        jobStart = new Date(self.year(), month, day, hour, minute).getTime();
                                        self.scheduleDateStart = new Date(self.year(), month, day, self.hour(),
                                                                          self.minute()).getTime();
                                        break;

                                    case REPEAT_SCHEDULE_MONTHLY:
                                        self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(),
                                                                          self.minute()).getTime();
                                        break;
                                    }
                                }
                            break;
                    }

                    var jobTime=jobs.jobTime *1000;
                    /* Add print separation to self.scheduleDateStart in milliseconds. Print separation will be at least one minute to make sure
                    that print to be scheduled starts one minute after previous print ends*/
                    var jobEnd = jobStart + jobTime + (self.printSeparation() * 60 * 1000);

                    var scheduleDateEnd = self.scheduleDateStart + (self.estimatedPrintTime * 1000);

                    /* Check the following cases to detect confilcts:
                     - Already scheduled job does not start after job to be scheduled and end before that scheduled job
                     - Job to be scheduled does not start after an already scheduled one and ends before that job already scheduled
                     - Already scheduled job does not start during job to be scheduled
                     - Already scheduled job does not end during job to be scheduled
                     Graphically, none of the following cases can happen:
                     Cron job:             |-----------------|
                     To be scheduled:    |---|             |---|
                                               |---------|
                                         |---------------------|
                    */
                    var scheduleConflict = (self.scheduleDateStart <= jobStart && jobEnd <= scheduleDateEnd) ||
                                           (jobStart <= self.scheduleDateStart && scheduleDateEnd <= jobEnd) || 
                                           (self.scheduleDateStart <= jobStart && jobStart <= scheduleDateEnd) || 
                                           (self.scheduleDateStart <= jobEnd && jobEnd <= scheduleDateEnd);
                    if ( scheduleConflict|| (currentPrintEnd != undefined && self.scheduleDateStart <= currentPrintEnd)) {
                        self.conflictsWith(jobs.fileName);
                        thereIsAConflict = true;
                    } else {
                        self.conflictsWith("No conflicts");
                    }
                });
            } else {
                if (self.loginState.isUser() && self.isPrinting()) {
                    var printTimeLeft = self.printerState.printTimeLeft() * 1000;
                    currentPrintEnd = new Date().getTime() + printTimeLeft;
                    if (!self.afterCurrentJob()) {
                        switch (self.getScheduleRepetition()) {
                            case SINGLE_SCHEDULE:
                                self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(), self.minute()).getTime();
                                break;

                            case REPEAT_SCHEDULE_DAILY:
                                self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(), self.minute()).getTime();
                                break;

                            case REPEAT_SCHEDULE_WEEKLY:
                                var daysToSum = 0;
                                if (self.dayOfWeek()!=undefined) {
                                    daysToSum = self.dayOfWeek().number - new Date().getDay();
                                }
                                self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day() + daysToSum, self.hour(),
                                                                  self.minute()).getTime();
                                break;

                            case REPEAT_SCHEDULE_MONTHLY:
                                self.scheduleDateStart = new Date(self.year(), self.month()-1, self.day(), self.hour(), self.minute()).getTime();
                                break;
                        }
                    }
                }

                if (self.afterCurrentJob()) {
                    currentPrintEnd = new Date().getTime() + printTimeLeft;
                    self.scheduleDateStart = new Date(currentPrintEnd + (self.printSeparation() * 60 * 1000));
                }
                if (currentPrintEnd != undefined && self.scheduleDateStart <= currentPrintEnd) {
                    self.conflictsWith("Current print");
                    thereIsAConflict = true;
                } else {
                    self.conflictsWith("No conflicts");
                }
            }
        };

        self.getDayOfWeek = function(year, month, day, hour, minute) {
            return new Date(year, month, day, hour, minute).getDay();
        };

        self.enableScheduleButton = ko.computed(function() {
            var currentDate=new Date();
            var scheduleDate=new Date(self.year(), self.month()-1, self.day(), self.hour(), self.minute());
            self.conflicts();
            var isValidDate = self.isValidDate(self.day(), self.month()-1, self.year());
            return (self.loginState.isUser() && ((self.deleteJob() && self.selectedJob() != undefined) ||
                   ((!self.afterCurrentJob() && isValidDate && ((scheduleDate.getTime() > currentDate.getTime() && 
                    self.conflictsWith() === "No conflicts"))) || self.repeatDaily() || (self.repeatWeekly() && self.dayOfWeek() != undefined) ||
                    self.repeatMonthly()) && !self.repetitionConflicts()) || self.afterCurrentJob());
        });

        self.isPrinting = ko.computed(function() {
            return self.printerState.isOperational() && self.printerState.isPrinting();
        });

        self.requestData = function() {
            return OctoPrint.schedule.listAllScheduledJobs()
                .done(function(data) {
                    self.fromResponse(data);
                });
        };

        self.fromResponse = function(data) {
            if (data["error"]) {
                new PNotify({
                    title: gettext("API key disabled"),
                    text: data["error"],
                    type: "error",
                    hide: false
                });
            } else {
            self.data = data;
            _.each(_.values(self.data), function(jobs) {
                   var hour = Number(jobs.jobStart["hour"]);
                   var minute = Number(jobs.jobStart["minute"]);
                   var month = jobs.jobStart["month"];
                   var day = jobs.jobStart["day_of_month"];
                   var dayOfWeek = jobs.jobStart["day_of_week"];
                   var text = undefined;
                   if (month === '*' && day === '*' && dayOfWeek === '*') {
                       text = 'Repeat print daily at ' + hour +' : ' + minute;
                   } else if (month === '*' && day != '*' && dayOfWeek === '*') {
                       switch (day) {
                           case '1':
                               dayText = '1st';
                               break;

                           case '2':
                               dayText = '2nd';
                               break;

                           case '3':
                               dayText = '3rd';
                               break;

                           default:
                                dayText = day +'th';
                       }
                       text = 'Repeat print the '+ dayText +' of every month at ' + hour +':' + minute;
                   } else if (month === '*' && day === '*' && dayOfWeek != '*') {
                       switch (dayOfWeek) {
                           case '0':
                               dayOfWeekText = 'Sunday';
                               break;

                           case '1':
                               dayOfWeekText = 'Monday';
                               break;

                           case '2':
                               dayOfWeekText = 'Tuesday';
                               break;

                           case '3':
                               dayOfWeekText = 'Wednesday';
                               break;

                           case '4':
                               dayOfWeekText = 'Thursday';
                               break;

                           case '5':
                               dayOfWeekText = 'Friday';
                               break;

                           case '6':
                               dayOfWeekText = 'Saturday';
                               break;
                       }
                       text = 'Print every ' + dayOfWeekText + ' at ' + hour + ':' + minute;
                   } else {
                       text = 'Print at ' + day +'/' + month +' ' + hour + ':' + minute;
                   }

                   self.alreadyScheduled.push({
                       filename: jobs.fileName,
                       day: day,
                       month: month,
                       hour: hour,
                       minute: minute,
                       dayOfWeek: dayOfWeek,
                       text : text
                   })
            });
            }
        };

        self.schedule = function() {
            if (!self.afterCurrentJob() && !self.deleteJob()) {
                var scheduleDay = undefined;
                var scheduleDayOfWeek = undefined;
                var scheduleMonth = undefined;
                if (self.repeatDaily()) {
                    scheduleDay = '*';
                    scheduleMonth = '*';
                    scheduleDayOfWeek = '*';
                } else if (self.repeatWeekly()) {
                    scheduleDay = '*';
                    scheduleMonth = '*';
                    scheduleDayOfWeek = self.dayOfWeek().number;
                } else  if (self.repeatMonthly()) {
                    scheduleDay = self.day();
                    scheduleMonth = '*';
                    scheduleDayOfWeek = '*';
                } else {
                    scheduleDay = self.day();
                    scheduleMonth = self.month();
                    scheduleDayOfWeek = self.getDayOfWeek(self.year(), self.month()-1, self.day(), self.hour(), self.minute());
                }

                var data = {
                    day_of_week: scheduleDayOfWeek,
                    day: scheduleDay,
                    month: scheduleMonth,
                    hour: self.hour(),
                    minute: self.minute(),
                    file: self.file,
                    target: self.target
                };
            } else {
                var data = {
                    day_of_week: self.getDayOfWeek(self.year(), self.month()-1, self.day(), self.hour(), self.minute()),
                    day:  new Date(self.scheduleDateStart).getDate(),
                    month: new Date(self.scheduleDateStart).getMonth()+1,
                    hour: new Date(self.scheduleDateStart).getHours(),
                    minute: new Date(self.scheduleDateStart).getMinutes(),
                    file: self.file,
                    target: self.target
                };
            }

            if (self.modifyJob()) {
                var jobData = {
                    day_of_week: self.selectedJob().dayOfWeek,
                    day: self.selectedJob().day,
                    month: self.selectedJob().month,
                    hour: self.selectedJob().hour,
                    minute: self.selectedJob().minute
                };
                OctoPrint.schedule.deleteJob(jobData)
                    .done(function() {
                        $("#schedule_configuration_dialog").modal("hide");
                    });
            }

            if (!self.deleteJob()) {
            OctoPrint.schedule.programNewJob(data)
                .done(function(returnedData) {
                    if (returnedData != undefined){
                        var user = {
                            name: 'autoprint',
                            password: returnedData.password,
                            admin: true,
                            active: true
                        };
                        self.users.addUser(user);
                    }
                    $("#schedule_configuration_dialog").modal("hide");
                });
            }
        };

        self._sanitize = function(name) {
            return name.replace(/[^a-zA-Z0-9\-_\.\(\) ]/g, "").replace(/ /g, "_");
        };

        /*self.onStartup = function() {
            self.requestData();
        };

        self.onEventSettingsUpdated = function(payload) {
            self.requestData();
        };*/

        self.scheduled = ko.computed(function() {
            return _.filter(self.alreadyScheduled(), function(job) {
                if (self.file === job.filename) {
                    return job;
                }
            });
        });

    }

    OCTOPRINT_VIEWMODELS.push([
        ScheduleViewModel,
        ["loginStateViewModel", "printerStateViewModel","usersViewModel"],
        "#schedule_configuration_dialog"
    ]);
});

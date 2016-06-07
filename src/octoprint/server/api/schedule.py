# coding=utf-8
from __future__ import absolute_import

__author__ = "Javier Martínez Arrieta <martinezarrietajavier@gmail.com>"
__license__ = 'GNU Affero General Public License http://www.gnu.org/licenses/agpl.html'
__copyright__ = "Copyright (C) 2014 The OctoPrint Project - Released under terms of the AGPLv3 License"

from flask import request, jsonify, make_response, url_for
from werkzeug.exceptions import BadRequest

from octoprint.filemanager.destinations import FileDestinations
from octoprint.server.util.flask import restricted_access
from octoprint.server.api import api, NO_CONTENT, files
from octoprint.server import printer,fileManager,userManager
from octoprint import settings as config
from octoprint import users
from crontab import CronTab


@api.route("/schedule", methods=["GET"])
@restricted_access
def getAllScheduledJobs():
	system_cron = CronTab(user=True)
	result = dict()
	index = 0

	localFileList = files._getFileList(FileDestinations.LOCAL,recursive=True)
	sdFileList = files._getFileList(FileDestinations.SDCARD,recursive=True)

	index = 0

	for job in system_cron:
		if '/api/schedule/print_job' in job.command:
			jobInfo = str(job).split()
			if ('apikey' in str(job)) and ('user' in str(job)):
				fileInfo = jobInfo[16]

			else:
				fileInfo = jobInfo[14]

			fileDestination = fileInfo.split('target=',1)[1]
			fileDestination = fileDestination[0 : fileDestination.index('&')]
			filename = fileInfo.split('&filename=',1)[1]
			filename = filename[0 : len(filename)-1]
			result[index] = dict()
			result[index]['fileName'] = filename
			if not '.stl' in filename:
				if fileDestination is 'sd':
					for sdFileInfo in sdFileList:
						if sdFileInfo["name"] == filename:
							if 'statistics' in sdFileInfo.keys() and '_default' in \
									   localFileInfo['statistics']['averagePrintTime']:
								result[index]['jobTime'] = sdFileInfo['statistics']['averagePrintTime']['_default']

							else:
								result[index]['jobTime'] = sdFileInfo['gcodeAnalysis']['estimatedPrintTime']
				else:
					for localFileInfo in localFileList:
						if localFileInfo["name"] == filename:
							try:
								result[index]['jobTime'] = \
											localFileInfo['statistics']['averagePrintTime']['_default']
								break
							except KeyError:
								result[index]['jobTime'] = localFileInfo['gcodeAnalysis']['estimatedPrintTime']

				result[index]['jobStart'] = {'minute' : jobInfo[0], 'hour' : jobInfo[1], 'day_of_month' : jobInfo[2], \
							     'month' : jobInfo[3], 'day_of_week' : jobInfo[4]}
				index = index +1

	return jsonify(result)


@api.route("/schedule/program_print",methods=["PUT"])
@restricted_access
def programPrint():
	if not "application/json" in request.headers["Content-Type"]:
		return make_response("Expected content-type JSON", 400)

	try:
		json_data = request.json
	except BadRequest:
		return make_response("Malformed JSON body in request", 400)

	allUsers = userManager.getAllUsers()
	nameExists = None
	userCreated=False
	for user in allUsers:
		if 'autoprint' in user["name"]:
			nameExists = True

	import os, stat
	path = os.environ["HOME"] + '/.octoprint/.autoprint_pass'
	settings = config.settings()
	accessControlEnabled = settings.get(["accessControl","enabled"])
	if accessControlEnabled:
		if nameExists is None:
			user = users.FilebasedUserManager()
			from random import getrandbits
			password = getrandbits(128)
			password = str(password)
			fd = os.open(path,os.O_WRONLY | os.O_CREAT)
			os.write(fd,password)
			os.fchmod(fd,stat.S_IREAD | stat.S_IWRITE)
			os.close(fd)
			nameExists = True
			userCreated=True
		else:
			fd = os.open(path, os.O_RDONLY)
			password = os.read(fd, 128)
			os.close(fd)

	command = None
	apiKey = None

	port = settings.get(["server","port"])
	if port is None:
		port=5000

	if settings.get(["api","enabled"]):
		apiKey = settings.get(["api","key"])
	if accessControlEnabled:
		setJob(port, apiKey, json_data, 'autoprint', password)
		if userCreated:
			return jsonify({"password": password})

	else:
		setJob(port, apiKey, json_data)

	return NO_CONTENT


@api.route("/schedule/print_job",methods=["GET"])
@restricted_access
def printJob():

	target=request.values["target"]
	filename=request.values["filename"]

	sd = False
	if target == FileDestinations.SDCARD:
		filenameToSelect = filename
		sd = True
	else:
		filenameToSelect = fileManager.path_on_disk(target, filename)

	# Check if printer is connected
	printerState = printer.get_state_id()
	if printerState == 'CLOSED' or printerState =='OFFLINE' or printerState =='PAUSED':
		# Try to connect printer 
		printer.connect()
		printerState = printer.get_state_id()

	if printerState == 'NONE' or printerState == 'OPEN_SERIAL' or printerState == 'DETECT_SERIAL' or printerState == 'DETECT_BAUDRATE' or \
			   printerState == 'CONNECTING':
		while printerState != 'OPERATIONAL' and printerState != 'CLOSED' and printerState != 'ERROR' and printerState != 'CLOSED_WITH_ERROR':
			printerState = printer.get_state_id()

	elif printerState == 'PRINTING':
		#Scheduled print must not be executed as something is printing at the moment
		pass

	if printerState == 'OPERATIONAL':
		printer.select_file(filenameToSelect, sd, True)

	# Check if it is a single job in order to delete it from the cron entry
	import datetime
	date = datetime.datetime.now()
	system_cron = CronTab(user=True)
	for job in system_cron:
		if (filename in job.command) and not('*' in job):
			# Check if job is the one that should be removed
			if job.day.on(date.day) and job.month.on(date.month) and job.hour.on(date.hour) and job.minute.on(date.minute):
				system_cron.remove(job)
				system_cron.write()

	return make_response("OK", 200)


@api.route("/schedule/delete_job",methods=["PUT"])
@restricted_access
def deleteJob():
	if not "application/json" in request.headers["Content-Type"]:
		return make_response("Expected content-type JSON", 400)

	try:
		json_data = request.json
	except BadRequest:
		return make_response("Malformed JSON body in request", 400)
	dateTime = str(json_data["minute"]) + ' ' + str(json_data["hour"]) + ' ' + str(json_data["day"]) + ' ' + str(json_data["month"]) + ' ' + str(json_data["day_of_week"])
	system_cron = CronTab(user=True)
	for job in system_cron:
		if '/api/schedule/print_job' in job.command and dateTime in str(job):
			system_cron.remove(job)
			system_cron.write()

	return NO_CONTENT


def setJob (port, apiKey, json_data, user=None , password=None):
	if apiKey is not None and user is not None:
		command='wget -qO- --header="Content-Type: application/json" "http://localhost:'+str(port)+'/api/login?apikey="'+apiKey+'"" --post-data \'{\"user\":\"'+user+'\",\"pass\":\"' + password + '",\"remember\":false}\' --keep-session-cookies &>/dev/null; wget -qO- \"http://localhost:'+str(port)+'/api/schedule/print_job?apikey="'+apiKey+'"&target='+json_data["target"]+'&filename='+json_data["file"]+'\" &>/dev/null'

	else:
		command='wget -qO- --header="Content-Type: application/json" "http://localhost:'+str(port)+'/api/login?apikey="'+apiKey+'"" --keep-session-cookies &>/dev/null; wget -qO- "http://localhost:'+str(port)+'/api/schedule/print_job?apikey="'+apiKey+'"&target='+json_data["target"]+'&filename='+json_data["file"]+'" &>/dev/null'


	system_cron=CronTab(user=True)
	job=system_cron.new(command)
	if json_data["day"] == '*' and json_data["month"] == '*' and json_data["day_of_week"] == '*':
		job.every().dom()

	elif json_data["day"] == '*' and json_data["month"] == '*':
		job.dow.on(json_data["day_of_week"])

	elif json_data["month"] == '*' and json_data["day_of_week"] == '*':
		job.every().month()
		job.day.on(json_data["day"])

	else:
		job.day.on(json_data["day"])
		job.month.on(json_data["month"])
		job.dow.on(json_data["day_of_week"])

	job.hour.on(json_data["hour"])
	job.minute.on(json_data["minute"])

	job.enable()
	system_cron.write()

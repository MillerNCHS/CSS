import React, { useState, useEffect } from "react";
import DraggableList from "react-draggable-list";

import ScheduleDropdown from "../components/ScheduleDropdown";
import PeriodEditor from "../components/PeriodEditor";

import "../styles/App.css";


function SchedulesPage()
{
    const [schedules, setSchedules] = useState({}); // All the schedules (initially recieved from the server)
    const [selection, setSelection] = useState(null); // The name of the schedule currently being modified (or a new empty schedule)

    const [tempScheduleName, setTempScheduleName] = useState(""); // The name of the schedule can be set by the user if it is a new schedule
    const [tempSchedule, setTempSchedule] = useState([]); // the contents of the schedule being modified / created

    const baseURL = "http://localhost:8500/"; // This will likly need to be changed for a production build


    // TODO: and authorization header can be used to make sure that this user has admin credentials
    function updateServerSchedules(info) // Sends the schedules to the server 
    {
        fetch(`${baseURL}schedules`,
        {
            method:"PUT",
            headers:{
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(info)
        });
    }


    // gets schedules JSON object from server
    useEffect(() => {
        fetch(`${baseURL}schedules`)
        .then((res) => res.json())
        .then((data) => {setSchedules(data);}
        );
    }, []);

    // called when a new schedule is selected from the schedule dropdown for modification
    function changeSelection(newSelection)
    {
        setSelection(newSelection);
        setTempScheduleName(newSelection);
        if (document.getElementById("ScheduleNameInput")) document.getElementById("ScheduleNameInput").value = "";

        if (newSelection === null) // an EMPTY schedule will contain no initial schedule data
        {
            setTempSchedule([]); // blank schedule
        }
        else // and existing schedule will auto-populate with the existing schedule data
        {
            setTempSchedule(schedules[newSelection]);
        }
    }

    // If this is a new schedule, the schedule name can be chosen by the user
    function changeScheduleName(e)
    {
        setTempScheduleName(e.target.value);
    }

    // The function to get an draggable list of all of the created periods 
    const [displayArr, setDisplayArr] = useState([]);
    function displayEditor()
    {
        var foundDifference = false;
        var newDisplayArr = [];

        if (tempSchedule.length < displayArr.length) foundDifference = true;
        for (let i = 0; i < tempSchedule.length; i++)
        {
            newDisplayArr.push({ id:i, name:tempSchedule[i].name, start:tempSchedule[i].start, end:tempSchedule[i].end });

            if (i >= displayArr.length || tempSchedule[i].name !== displayArr[i].name || tempSchedule[i].start !== displayArr[i].start || tempSchedule[i].end !== displayArr[i].end) foundDifference = true;
        }

        if (foundDifference) setDisplayArr(newDisplayArr);
        
        
        return <DraggableList 
            itemKey="id"
            template={PeriodEditor}
            list={displayArr}
            container={() => {return document.body;}}
            commonProps={periodEditUpdate}
            onMoveEnd={reposition}

            constrainDrag = {true}
        />;

        // Called whenever a PeriodEditor is modified. Updates the currently selected schedule accordingly.
        function periodEditUpdate(res)
        {
            if (res.delete)
            {
                const copiedTempSchedule = [...tempSchedule]; // create a shallow copy of tempSchedule to be modified
                const index = res.id;
                copiedTempSchedule.splice(index, 1);

                setTempSchedule(copiedTempSchedule);
                
                return;
            }

            const index = res.id;
            delete res.id;

            const copiedTempSchedule = [...tempSchedule]; // create a shallow copy of tempSchedule to be modified
            copiedTempSchedule[index] = res;
            
            setTempSchedule(copiedTempSchedule);
        }

        function reposition(res)
        {
            const newTempSchedule = [];

            for (const i in res)
            {
                newTempSchedule.push({name:res[i].name, start:res[i].start, end:res[i].end});
            }

            setDisplayArr(res);
            setTempSchedule(newTempSchedule);
        }
    }

    function addPeriod() // Add on a new empty period
    {
        const newTempSchedule = [...tempSchedule]; 
        const p = {};
        p.name = "";
        p.start = newTempSchedule.length > 0 ? newTempSchedule[newTempSchedule.length - 1].start : "00:00";
        p.end = p.start;

        newTempSchedule.push(p);
        
        setTempSchedule(newTempSchedule);
    }
    function deletePeriod(index = -1) // Deletes the last period in the schedule
    {
        const newTempSchedule = [...tempSchedule];
        
        if (newTempSchedule.length > 0) 
        {
            newTempSchedule.pop();
        }

        setTempSchedule(newTempSchedule);
    }

    // This function will return a button to delete the schedule if the user is modifying an old schedule (i.e. a prexisting schedule is selected)
    // BUT, will return a text input field for the schedule name if the user is creating a new schedule (i.e. empty is selected)
    function specialInput() // delete schedule or name schedule
    {
        // -- field for nameing schedule --
        if (selection === null) 
        {
            return <input className="box" id="ScheduleNameInput" type="text" placeholder="Schedule Name" onInput={changeScheduleName}></input>;
        }

        // -- button for deleteing schedule --
        return(
            <button className="button" onClick={() => {
                if (window.confirm("Are you sure that you want to delete schedule \"" + selection + "\" ?"))
                {
                    const copiedSchedules = {...schedules}; // shallow copy
                    delete copiedSchedules[selection]; // delete the selected schedule from the objec storeing all the schedules

                    setSchedules(copiedSchedules); // update original
                    updateServerSchedules(copiedSchedules); // update the server with the new schedules JSON object
                    changeSelection(null); // set EMPTY as the current selection (i.e. the option to create a new schedule should be auto-selected now that the current schedule was deleted)
                }
            }}>DELETE SCHEDULE</button>
        );
    }

    // check schedule validity and update the server with the new schedule JSON object
    function submitSchedule()
    {
        // -- check schedule validity -- (The user will not be allowed to submit and an error message will be displayed)
        if (tempScheduleName === null || tempScheduleName === "" || tempScheduleName === "NEW SCHEDULE") // invalid schedule name
        {
            window.alert("Invalid Schedule Name!");
            return;
        }

        if (selection === null && schedules[tempScheduleName]) // Schedule name already exists (no duplicate schedules)
        {
            window.alert("Invalid Schedule Name!\nThe Schedule \"" + tempScheduleName + "\" Already Exists!");
            return;
        }

        if (!tempSchedule || tempSchedule.length === 0) // the schedule is empty
        {
            window.alert("Input Periods!");
            return;
        }

        // Check to see if the period start/end times conflict
        var prevTime = "00:00";
        for (let i = 0; i < tempSchedule.length; i++)
        {
            if (tempSchedule[i].start >= prevTime)
            {
                prevTime = tempSchedule[i].start;
            }
            else
            {
                window.alert("Invalid Start Time: (row " + (i + 1) + ")");
                return;
            }
            if (tempSchedule[i].end >= prevTime)
            {
                prevTime = tempSchedule[i].end;
            }
            else
            {
                window.alert("Invalid End Time: (row " + (i + 1) + ")");
                return;
            }
        }

        // -- update server & reset states --
        if (selection === null) // if this is a completely new schedule
        {
            const copiedSchedules = {...schedules};
            copiedSchedules[tempScheduleName] = tempSchedule;
            setSchedules(copiedSchedules);
            updateServerSchedules(copiedSchedules);
            changeSelection(null);

            window.alert("Added New Schedule");
        }
        else if (selection === tempScheduleName) // if an prexisting schdule is being modified
        {
            const copiedSchedules = {...schedules};
            copiedSchedules[tempScheduleName] = tempSchedule;
            setSchedules(copiedSchedules);
            updateServerSchedules(copiedSchedules);
            changeSelection(null);

            window.alert("Updated Schedule");
        }
    }


    return(
        <div className="Content">
            <header className="App-header">
                <h1>Schedules</h1>
            </header>

            <div className="List">
                <ScheduleDropdown nullSelectionName={"NEW SCHEDULE"} defaultValue={selection} callback={changeSelection} />

                {specialInput()}
            </div>
            <div className="List">
                <table className="Table">
                    <thead>
                        <tr>
                            <th>Period</th>
                            <th>Start</th>
                            <th>End</th>
                        </tr>
                    </thead>
                </table>

                {displayEditor()}
            </div>
            <div className="List">
                <button className="button" onClick={addPeriod}>Add Period</button>
                <button className="button" onClick={deletePeriod}>Delete Period</button>
                <button className="button" onClick={submitSchedule}>Submit form</button>
            </div>
        </div>
    );
}

export default SchedulesPage;